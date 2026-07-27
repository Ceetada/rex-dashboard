import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface DebitRequest {
  userId: string;
  amountKobo: bigint;
  narration: string;
  transactionId: string;
}

/**
 * The wallet ledger.
 *
 * Three rules hold everywhere in this file:
 *
 *  1. Money is BigInt kobo. No floats, no Decimal, no exceptions.
 *  2. Balance changes only ever happen inside a database transaction that also
 *     writes the corresponding ledger row. A balance without an explaining
 *     entry is corruption, and the two must succeed or fail together.
 *  3. Reads that precede a write use SELECT ... FOR UPDATE. Two concurrent
 *     debits that both read ₦500 and both write ₦0 let a user spend ₦1000 —
 *     this is the classic double-spend, and optimistic checks alone do not
 *     prevent it under real concurrency.
 *
 * `balance` is settled funds. `ledgerBalance` is balance minus in-flight
 * debits — a VTU purchase holds funds while the aggregator is still deciding,
 * so the same naira cannot be spent twice while an order is pending.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string) {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.wallet.create({ data: { userId } });
  }

  async getBalance(userId: string): Promise<{ balanceKobo: bigint; availableKobo: bigint; isFrozen: boolean }> {
    const wallet = await this.getOrCreate(userId);
    return {
      balanceKobo: wallet.balance,
      // ledgerBalance is already balance minus in-flight holds, so it *is* the
      // spendable figure. The UI shows balance and, when they differ, explains
      // the gap as "₦X pending" rather than silently showing a smaller number.
      availableKobo: wallet.ledgerBalance,
      isFrozen: wallet.isFrozen,
    };
  }

  /**
   * Debits the wallet inside the caller's transaction.
   *
   * Takes a transaction client rather than opening its own, because the debit
   * and the thing being paid for must commit atomically. A debit that commits
   * while the service order rolls back is money taken for nothing.
   */
  async debit(tx: Prisma.TransactionClient, request: DebitRequest): Promise<bigint> {
    const { userId, amountKobo, narration, transactionId } = request;

    if (amountKobo <= 0n) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    }

    // Row lock. Everything below this line is serialised per wallet.
    //
    // The identifiers are double-quoted because Prisma names columns after the
    // model fields — "ledgerBalance", not ledger_balance — and PostgreSQL
    // lower-cases anything unquoted. Dropping the quotes makes every debit fail
    // with `column "ledgerbalance" does not exist`.
    const [wallet] = await tx.$queryRaw<
      Array<{ id: string; balance: bigint; ledgerBalance: bigint; isFrozen: boolean }>
    >`
      SELECT id, balance, "ledgerBalance", "isFrozen"
      FROM wallets
      WHERE "userId" = ${userId}::uuid
      FOR UPDATE
    `;

    if (!wallet) {
      throw new BadRequestException({ code: 'NO_WALLET', message: 'Wallet not found' });
    }
    if (wallet.isFrozen) {
      throw new ConflictException({
        code: 'WALLET_FROZEN',
        message: 'Your wallet is on hold. Please contact support.',
      });
    }
    if (wallet.balance < amountKobo) {
      throw new ConflictException({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Your wallet balance is too low for this transaction',
        // The client turns this into a "Top up ₦X more" call to action.
        shortfallKobo: Number(amountKobo - wallet.balance),
      });
    }

    const balanceAfter = wallet.balance - amountKobo;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        ledgerBalance: wallet.ledgerBalance - amountKobo,
        version: { increment: 1 },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        transactionId,
        direction: 'DEBIT',
        amount: amountKobo,
        balanceAfter,
        narration,
      },
    });

    return balanceAfter;
  }

  async credit(
    tx: Prisma.TransactionClient,
    request: DebitRequest & { allowFrozen?: boolean },
  ): Promise<bigint> {
    const { userId, amountKobo, narration, transactionId, allowFrozen = false } = request;

    if (amountKobo <= 0n) {
      throw new BadRequestException({ code: 'INVALID_AMOUNT', message: 'Amount must be positive' });
    }

    const [wallet] = await tx.$queryRaw<
      Array<{ id: string; balance: bigint; ledgerBalance: bigint; isFrozen: boolean }>
    >`
      SELECT id, balance, "ledgerBalance", "isFrozen"
      FROM wallets
      WHERE "userId" = ${userId}::uuid
      FOR UPDATE
    `;

    if (!wallet) throw new BadRequestException({ code: 'NO_WALLET', message: 'Wallet not found' });

    // A frozen wallet still accepts refunds and reversals — freezing stops
    // money leaving, not money being returned to a user we owe.
    if (wallet.isFrozen && !allowFrozen) {
      throw new ConflictException({ code: 'WALLET_FROZEN', message: 'Wallet is on hold' });
    }

    const balanceAfter = wallet.balance + amountKobo;

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: balanceAfter,
        ledgerBalance: wallet.ledgerBalance + amountKobo,
        version: { increment: 1 },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        transactionId,
        direction: 'CREDIT',
        amount: amountKobo,
        balanceAfter,
        narration,
      },
    });

    return balanceAfter;
  }

  /**
   * Returns funds for an order that failed after the debit.
   *
   * Implemented as a compensating credit rather than by deleting or editing the
   * original debit: the ledger is append-only, so a user's statement shows both
   * the charge and the refund. Anything else makes disputes unanswerable.
   */
  async refund(
    tx: Prisma.TransactionClient,
    input: { userId: string; amountKobo: bigint; originalTransactionId: string; reason: string },
  ): Promise<void> {
    const original = await tx.transaction.findUnique({
      where: { id: input.originalTransactionId },
    });
    if (!original) throw new BadRequestException({ code: 'NO_TRANSACTION', message: 'Unknown transaction' });

    // Idempotence: a reconciliation job may try to refund the same order more
    // than once, and refunding twice is worse than not refunding at all.
    if (original.reversedAt) {
      this.logger.warn(`Refund skipped, already reversed: ${original.reference}`);
      return;
    }

    const reversal = await tx.transaction.create({
      data: {
        reference: `RV-${original.reference}`,
        userId: input.userId,
        type: 'REVERSAL',
        status: 'SUCCESSFUL',
        channel: 'WALLET',
        amount: input.amountKobo,
        total: input.amountKobo,
        description: `Reversal: ${input.reason}`,
        completedAt: new Date(),
        metadata: { originalTransactionId: original.id, reason: input.reason },
      },
    });

    await this.credit(tx, {
      userId: input.userId,
      amountKobo: input.amountKobo,
      narration: `Refund for ${original.reference}`,
      transactionId: reversal.id,
      allowFrozen: true,
    });

    await tx.transaction.update({
      where: { id: original.id },
      data: { status: 'REVERSED', reversedAt: new Date() },
    });
  }

  /**
   * Holds funds for an in-flight purchase without settling them.
   * Reduces spendable balance immediately so a second purchase cannot use the
   * same money while the first is still pending at the provider.
   */
  async hold(tx: Prisma.TransactionClient, userId: string, amountKobo: bigint): Promise<void> {
    const [wallet] = await tx.$queryRaw<Array<{ id: string; balance: bigint; ledgerBalance: bigint }>>`
      SELECT id, balance, "ledgerBalance" FROM wallets WHERE "userId" = ${userId}::uuid FOR UPDATE
    `;
    if (!wallet) throw new BadRequestException({ code: 'NO_WALLET', message: 'Wallet not found' });
    if (wallet.ledgerBalance < amountKobo) {
      throw new ConflictException({
        code: 'INSUFFICIENT_FUNDS',
        message: 'Your wallet balance is too low for this transaction',
      });
    }
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { ledgerBalance: wallet.ledgerBalance - amountKobo, version: { increment: 1 } },
    });
  }

  async getStatement(userId: string, options: { cursor?: string; limit: number }) {
    const wallet = await this.getOrCreate(userId);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { transaction: { select: { reference: true, type: true, status: true } } },
    });

    const hasMore = entries.length > options.limit;
    const page = hasMore ? entries.slice(0, options.limit) : entries;

    return {
      data: page.map((entry) => ({
        id: entry.id,
        direction: entry.direction,
        amountKobo: Number(entry.amount),
        balanceAfterKobo: Number(entry.balanceAfter),
        narration: entry.narration,
        reference: entry.transaction?.reference ?? null,
        type: entry.transaction?.type ?? null,
        status: entry.transaction?.status ?? null,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }
}

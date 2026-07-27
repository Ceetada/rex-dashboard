import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { WalletService } from '../src/modules/wallet/wallet.service';

/**
 * The double-spend test.
 *
 * This is the most important test in the repository, and it only means anything
 * against a real PostgreSQL. `WalletService.debit` reads the balance with
 * `SELECT ... FOR UPDATE` before writing it; the entire correctness of the
 * ledger rests on that lock actually serialising concurrent debits.
 *
 * A mocked version of this test passes against an implementation with the lock
 * removed, because a mock has no notion of two transactions racing. That is
 * why the unit spec asserts only that the service *asks* for the lock, and the
 * proof that the lock works lives here.
 */

const prisma = new PrismaClient();
const wallet = new WalletService(prisma as never);

const NAIRA = (amount: number) => BigInt(amount * 100);

/** Creates an isolated user + wallet so tests never contend with each other. */
async function makeWallet(balanceNaira: number) {
  const user = await prisma.user.create({
    data: {
      email: `concurrency-${randomUUID()}@test.local`,
      passwordHash: 'not-a-real-hash',
      status: 'ACTIVE',
      wallet: { create: { balance: NAIRA(balanceNaira), ledgerBalance: NAIRA(balanceNaira) } },
    },
    include: { wallet: true },
  });
  return { userId: user.id, walletId: user.wallet!.id };
}

/** Runs a debit in its own serializable transaction, exactly as the app does. */
function debit(userId: string, amountNaira: number, reference: string) {
  return prisma.$transaction(
    async (tx) => {
      const transaction = await tx.transaction.create({
        data: {
          reference,
          userId,
          type: 'AIRTIME_PURCHASE',
          status: 'PROCESSING',
          amount: NAIRA(amountNaira),
          total: NAIRA(amountNaira),
          description: 'Concurrency test',
        },
      });
      return wallet.debit(tx, {
        userId,
        amountKobo: NAIRA(amountNaira),
        narration: 'Concurrency test',
        transactionId: transaction.id,
      });
    },
    { isolationLevel: 'Serializable', timeout: 20_000 },
  );
}

async function state(userId: string, walletId: string) {
  const [w, entries] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: walletId } }),
    prisma.ledgerEntry.count({ where: { walletId } }),
  ]);
  return { balance: w.balance, entries };
}

describe('wallet concurrency (real PostgreSQL)', () => {
  beforeEach(async () => {
    await prisma.$executeRaw`SELECT 1`; // fail fast if the database is unreachable
  });

  afterAll(async () => {
    // Transactions deliberately do not cascade from User — a financial record
    // must not vanish because an account was removed (see docs/17-compliance).
    // So test rows come out in dependency order rather than in one delete.
    const users = await prisma.user.findMany({
      where: { email: { contains: 'concurrency-' } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { transaction: { userId: { in: userIds } } } });
      await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  it('lets exactly one of two simultaneous debits succeed', async () => {
    const { userId, walletId } = await makeWallet(500);

    // Both ask for the full balance at the same instant. Without the row lock
    // both would read ₦500, both would write ₦0, and the user would have spent
    // ₦1,000 they never had.
    const results = await Promise.allSettled([
      debit(userId, 500, `CC-${randomUUID().slice(0, 8)}`),
      debit(userId, 500, `CC-${randomUUID().slice(0, 8)}`),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const after = await state(userId, walletId);
    expect(after.balance).toBe(0n);
    // One debit means exactly one explaining ledger row. Two would mean the
    // balance and the ledger had diverged, which is corruption.
    expect(after.entries).toBe(1);
  });

  it('never oversells under heavy contention', async () => {
    // Ten concurrent ₦100 debits against ₦500. Exactly five must win — this is
    // the shape of a real month-end spike on one account.
    const { userId, walletId } = await makeWallet(500);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => debit(userId, 100, `CC-${randomUUID().slice(0, 8)}`)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const after = await state(userId, walletId);

    // Serialization failures can make a would-be-valid debit retry-able rather
    // than successful, so the invariant is not "exactly five" — it is that the
    // balance never goes negative and always equals what the ledger explains.
    expect(after.balance).toBeGreaterThanOrEqual(0n);
    expect(after.balance).toBe(NAIRA(500) - NAIRA(100 * succeeded));
    expect(after.entries).toBe(succeeded);
    expect(succeeded).toBeLessThanOrEqual(5);
  });

  it('keeps the balance and the ledger in agreement', async () => {
    const { userId, walletId } = await makeWallet(1000);

    await Promise.allSettled([
      debit(userId, 300, `CC-${randomUUID().slice(0, 8)}`),
      debit(userId, 200, `CC-${randomUUID().slice(0, 8)}`),
      debit(userId, 400, `CC-${randomUUID().slice(0, 8)}`),
    ]);

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'asc' },
    });
    const debited = entries.reduce((sum, e) => sum + e.amount, 0n);
    const after = await state(userId, walletId);

    // The ledger is the source of truth: replaying it must reproduce the
    // balance exactly. If these ever disagree, money has been invented or lost.
    expect(after.balance).toBe(NAIRA(1000) - debited);

    // Every entry's recorded balanceAfter must match a real replay, which is
    // what lets a statement be rendered without recomputing from history.
    let running = NAIRA(1000);
    for (const entry of entries) {
      running -= entry.amount;
      expect(entry.balanceAfter).toBe(running);
    }
  });

  it('refuses to overdraw even when the debit exactly exceeds the balance', async () => {
    const { userId, walletId } = await makeWallet(500);

    await expect(debit(userId, 501, `CC-${randomUUID().slice(0, 8)}`)).rejects.toThrow();

    const after = await state(userId, walletId);
    expect(after.balance).toBe(NAIRA(500));
    // A rejected debit must leave no trace — no ledger row, no partial write.
    expect(after.entries).toBe(0);
  });
});

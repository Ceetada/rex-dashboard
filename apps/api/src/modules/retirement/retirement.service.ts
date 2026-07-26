import { Injectable, NotFoundException } from '@nestjs/common';
import { maskIdentifier } from '@evas/contracts';

import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Retirement savings and statutory pension.
 *
 * These are two genuinely different things and the code keeps them apart:
 *
 *  * Retirement savings is *ours*. The user contributes, we hold the balance,
 *    we are the system of record, and every naira is in our ledger.
 *
 *  * Pension is the PFA's. Under the Pension Reform Act the Pension Fund
 *    Administrator holds and administers the RSA — we mirror it for display.
 *    Everything pension-shaped therefore carries `lastSyncedAt`, and the UI
 *    labels it as provider-sourced. Presenting mirrored data as if it were live
 *    is how a user ends up making a retirement decision on a stale number.
 */
@Injectable()
export class RetirementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly encryption: EncryptionService,
  ) {}

  async getAccount(userId: string) {
    const account = await this.prisma.retirementAccount.findUnique({
      where: { userId },
      include: { holdings: true },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'NO_RETIREMENT_ACCOUNT',
        message: 'You do not have a retirement savings account yet',
      });
    }

    // The chart series is read from pre-computed valuations rather than
    // replayed from the contribution history — the latter gets slower every
    // month a user stays with us, and this endpoint is on the dashboard.
    const valuations = await this.prisma.accountValuation.findMany({
      where: { accountId: account.id },
      orderBy: { asOfDate: 'asc' },
      take: 24,
    });

    const growthPct =
      account.totalContributed > 0n
        ? Number((account.totalGrowth * 10_000n) / account.totalContributed) / 100
        : 0;

    return {
      id: account.id,
      accountNumber: account.accountNumber,
      riskProfile: account.riskProfile,
      balanceKobo: Number(account.balance),
      totalContributedKobo: Number(account.totalContributed),
      totalGrowthKobo: Number(account.totalGrowth),
      growthPct,
      targetAmountKobo: account.targetAmount ? Number(account.targetAmount) : null,
      targetDate: account.targetDate?.toISOString() ?? null,
      targetProgressPct: account.targetAmount
        ? Math.min(100, Number((account.balance * 100n) / account.targetAmount))
        : null,
      autoDebit: {
        enabled: account.autoDebitEnabled,
        amountKobo: account.autoDebitAmount ? Number(account.autoDebitAmount) : null,
        dayOfMonth: account.autoDebitDayOfMonth,
      },
      holdings: account.holdings.map((h) => ({
        assetClass: h.assetClass,
        instrument: h.instrument,
        currentValueKobo: Number(h.currentValue),
        allocationPct: Number(h.allocationPct),
      })),
      monthlySeries: valuations.map((v) => ({
        month: v.asOfDate.toISOString().slice(0, 7),
        contributedKobo: Number(v.contributed),
        balanceKobo: Number(v.balance),
        growthKobo: Number(v.growth),
      })),
    };
  }

  async contribute(
    userId: string,
    input: { idempotencyKey: string; amountKobo: number; source: string; paymentChannel: string },
  ) {
    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { reference: existing.reference, status: existing.status, replayed: true };

    const account = await this.prisma.retirementAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new NotFoundException({ code: 'NO_RETIREMENT_ACCOUNT', message: 'No retirement account' });
    }

    const amount = BigInt(input.amountKobo);

    return this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            reference: `EVS-R${Date.now().toString(36).toUpperCase()}`,
            userId,
            type: 'RETIREMENT_CONTRIBUTION',
            status: 'SUCCESSFUL',
            channel: input.paymentChannel as never,
            amount,
            total: amount,
            idempotencyKey: input.idempotencyKey,
            description: 'Retirement contribution',
            completedAt: new Date(),
          },
        });

        if (input.paymentChannel === 'WALLET') {
          await this.wallet.debit(tx, {
            userId,
            amountKobo: amount,
            narration: 'Retirement contribution',
            transactionId: transaction.id,
          });
        }

        // Normalised to the 1st so the monthly chart is a plain GROUP BY.
        const period = new Date();
        period.setDate(1);
        period.setHours(0, 0, 0, 0);

        await tx.retirementContribution.create({
          data: {
            accountId: account.id,
            amount,
            source: input.source as never,
            periodMonth: period,
            transactionId: transaction.id,
          },
        });

        // Balance and total move together with the contribution row, inside the
        // same transaction — a contribution without a matching balance change
        // is corruption.
        await tx.retirementAccount.update({
          where: { id: account.id },
          data: {
            balance: { increment: amount },
            totalContributed: { increment: amount },
          },
        });

        return { reference: transaction.reference, status: transaction.status, replayed: false };
      },
      { isolationLevel: 'Serializable', timeout: 15_000 },
    );
  }

  async getPension(userId: string) {
    const account = await this.prisma.pensionAccount.findUnique({
      where: { userId },
      include: {
        pfa: true,
        statements: { orderBy: { periodEnd: 'desc' }, take: 12 },
      },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'NO_PENSION_ACCOUNT',
        message: 'Link your RSA to see your pension benefits',
      });
    }

    const rsaNumber = this.encryption.decrypt(account.rsaNumberEncrypted);

    return {
      id: account.id,
      pfa: { id: account.pfa.id, name: account.pfa.name, logoUrl: account.pfa.logoUrl },
      // An RSA number is a lifelong national identifier. It is masked on the
      // way out and never logged.
      rsaNumberMasked: maskIdentifier(rsaNumber),
      employerName: account.employerName,
      currentBalanceKobo: Number(account.currentBalance),
      totalContributionsKobo: Number(account.totalContributions),
      employeeContributionsKobo: Number(account.employeeContributions),
      employerContributionsKobo: Number(account.employerContributions),
      totalReturnsKobo: Number(account.totalReturns),
      estimatedBenefitKobo: account.estimatedBenefit ? Number(account.estimatedBenefit) : null,
      retirementAge: account.retirementAge,
      yearsToRetirement: null,
      // Surfaced deliberately: the UI shows "as at <date>" so nobody mistakes
      // mirrored data for a live balance.
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      statements: account.statements.map((s) => ({
        id: s.id,
        periodStart: s.periodStart.toISOString().slice(0, 10),
        periodEnd: s.periodEnd.toISOString().slice(0, 10),
        closingBalanceKobo: Number(s.closingBalance),
        hasDocument: Boolean(s.documentKey),
      })),
    };
  }

  async listContributions(userId: string, options: { cursor?: string; limit: number }) {
    const account = await this.prisma.retirementAccount.findUnique({ where: { userId } });
    if (!account) return { data: [], nextCursor: null, hasMore: false };

    const contributions = await this.prisma.retirementContribution.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = contributions.length > options.limit;
    const page = hasMore ? contributions.slice(0, options.limit) : contributions;

    return {
      data: page.map((c) => ({
        id: c.id,
        amountKobo: Number(c.amount),
        source: c.source,
        periodMonth: c.periodMonth.toISOString().slice(0, 7),
        narration: c.narration,
        createdAt: c.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }
}

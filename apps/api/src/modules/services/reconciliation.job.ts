import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProviderRegistry } from '../providers/provider.registry';
import type { CableAdapter, VtuAdapter } from '../providers/provider.types';
import { WalletService } from '../wallet/wallet.service';

/**
 * Resolves orders the provider never gave a definite answer for.
 *
 * This job is the reason the platform can be trusted with money. When an
 * aggregator times out, we genuinely do not know whether the airtime landed.
 * Refunding immediately gives away product; marking it delivered charges for
 * nothing. So the order is parked, and this job asks the provider — repeatedly,
 * with backoff — until it commits to an answer.
 *
 * After the give-up threshold the order is refunded and flagged for a human.
 * That choice is deliberate: at the margin we would rather absorb the cost of a
 * genuinely-delivered top-up than leave a user out of pocket with no recourse.
 * Every such case is audit-logged so the loss is measurable, not invisible.
 */
@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);
  private readonly maxAttempts = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilePendingOrders(): Promise<void> {
    const orders = await this.prisma.serviceOrder.findMany({
      where: {
        status: { in: ['REQUIRES_RECONCILIATION', 'PROCESSING'] },
        // Give the provider a moment to settle before the first requery —
        // asking one second later almost always returns "still processing".
        createdAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
        attemptCount: { lt: this.maxAttempts },
      },
      include: { provider: true, transaction: true },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    if (orders.length === 0) return;
    this.logger.log(`Reconciling ${orders.length} order(s)`);

    for (const order of orders) {
      // Exponential backoff per order: 2, 4, 8, 16... minutes since last try.
      const backoffMs = 2 ** order.attemptCount * 60 * 1000;
      if (order.lastAttemptAt && Date.now() - order.lastAttemptAt.getTime() < backoffMs) continue;

      try {
        await this.reconcileOne(order);
      } catch (error) {
        this.logger.error(
          `Reconciliation failed for ${order.reference}: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
  }

  private async reconcileOne(order: {
    id: string;
    reference: string;
    userId: string;
    serviceType: string;
    amount: bigint;
    attemptCount: number;
    transactionId: string | null;
    provider: { slug: string } | null;
  }): Promise<void> {
    if (!order.provider || !order.transactionId) {
      // No provider was ever selected, so nothing was sent. Safe to refund.
      await this.refund(order, 'Order never reached a provider');
      return;
    }

    const adapter = this.registry.get<VtuAdapter | CableAdapter>(order.provider.slug);
    const outcome = await this.registry.execute(order.provider.slug, () =>
      adapter.requery(order.reference),
    );

    await this.prisma.serviceOrder.update({
      where: { id: order.id },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });

    if (outcome.status === 'DELIVERED') {
      await this.prisma.$transaction(async (tx) => {
        await tx.serviceOrder.update({
          where: { id: order.id },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date(),
            providerReference: outcome.providerReference,
          },
        });
        await tx.transaction.update({
          where: { id: order.transactionId! },
          data: { status: 'SUCCESSFUL', completedAt: new Date() },
        });
      });

      await this.notifications.send(order.userId, {
        category: 'SERVICE',
        title: 'Purchase confirmed',
        body: 'We confirmed your purchase with the network. It went through.',
        actionUrl: `/services/history/${order.reference}`,
      });
      this.logger.log(`Reconciled ${order.reference} as DELIVERED`);
      return;
    }

    if (outcome.status === 'FAILED') {
      await this.refund(order, outcome.reason);
      return;
    }

    // Still UNKNOWN. Keep waiting unless we have run out of patience.
    if (order.attemptCount + 1 >= this.maxAttempts) {
      await this.refund(
        order,
        'Could not confirm with the provider after repeated attempts — refunded in the user\'s favour',
        true,
      );
    }
  }

  private async refund(
    order: { id: string; reference: string; userId: string; amount: bigint; transactionId: string | null },
    reason: string,
    needsReview = false,
  ): Promise<void> {
    if (order.transactionId) {
      await this.prisma.$transaction(async (tx) => {
        await this.wallet.refund(tx, {
          userId: order.userId,
          amountKobo: order.amount,
          originalTransactionId: order.transactionId!,
          reason,
        });
        await tx.serviceOrder.update({
          where: { id: order.id },
          data: { status: 'REFUNDED', failureReason: reason },
        });
      });
    }

    await this.audit.record({
      actorId: null,
      actorType: 'SYSTEM',
      action: needsReview ? 'service_order.refunded_unconfirmed' : 'service_order.refunded',
      resource: 'ServiceOrder',
      resourceId: order.id,
      outcome: needsReview ? 'FAILURE' : 'SUCCESS',
      reason,
      // Flags the row for the admin "needs review" queue — an unconfirmed
      // refund is a potential real loss and someone should look at it.
      after: { needsManualReview: needsReview, reference: order.reference },
    });

    await this.notifications.send(order.userId, {
      category: 'SERVICE',
      title: 'Purchase refunded',
      body: 'We could not confirm your purchase, so we have returned the money to your wallet.',
      actionUrl: `/services/history/${order.reference}`,
    });

    this.logger.warn(`Refunded ${order.reference}: ${reason}`);
  }

  /**
   * Expired idempotency records and consumed OTPs are not worth keeping. This
   * is also where NDPA retention rules are applied to short-lived data.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async pruneExpiredRecords(): Promise<void> {
    const now = new Date();
    const [idempotency, otps, tokens] = await Promise.all([
      this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    if (idempotency.count + otps.count + tokens.count > 0) {
      this.logger.log(
        `Pruned ${idempotency.count} idempotency, ${otps.count} OTP, ${tokens.count} token records`,
      );
    }
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { SubscribeToPlanInput } from '@evas/contracts';
import { maskIdentifier } from '@evas/contracts';

import { AuditService } from '../../common/audit/audit.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Health plans.
 *
 * The catalogue is entirely data-driven. Nothing here branches on plan tier to
 * decide what to render — a Family plan is just a plan whose `maxDependants` is
 * greater than zero, and its benefits are rows. Adding a fourth or fifth plan is
 * an insert, which is what the "easily support additional plans" requirement
 * actually demands.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async listPlans() {
    const plans = await this.prisma.healthPlan.findMany({
      where: { isActive: true, isPubliclyListed: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        hmoProvider: true,
        benefits: { orderBy: { displayOrder: 'asc' } },
        _count: { select: { subscriptions: true } },
      },
    });

    // Hospital counts come from one grouped query rather than N per-plan
    // queries — this endpoint renders the main marketing surface and is hit
    // by every logged-out visitor.
    const hospitalCounts = await this.prisma.hospital.groupBy({
      by: ['hmoProviderId'],
      where: { isActive: true },
      _count: { _all: true },
    });
    const countByProvider = new Map(hospitalCounts.map((h) => [h.hmoProviderId, h._count._all]));

    return plans.map((plan) => this.toPlanDto(plan, countByProvider.get(plan.hmoProviderId ?? '') ?? 0));
  }

  async getPlan(slug: string) {
    const plan = await this.prisma.healthPlan.findUnique({
      where: { slug },
      include: { hmoProvider: true, benefits: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'That plan is not available' });
    }
    const hospitalCount = plan.hmoProviderId
      ? await this.prisma.hospital.count({ where: { hmoProviderId: plan.hmoProviderId, isActive: true } })
      : 0;
    return this.toPlanDto(plan, hospitalCount);
  }

  async listSubscriptions(userId: string) {
    const subscriptions = await this.prisma.healthSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: { include: { hmoProvider: true, benefits: { orderBy: { displayOrder: 'asc' } } } },
        dependants: { where: { isActive: true } },
      },
    });

    return subscriptions.map((subscription) => ({
      id: subscription.id,
      plan: this.toPlanDto(subscription.plan, 0),
      status: subscription.status,
      // Member numbers identify a person's medical records. Masked, always.
      memberNumberMasked: subscription.memberNumberEncrypted
        ? maskIdentifier(this.encryption.decrypt(subscription.memberNumberEncrypted))
        : null,
      startDate: subscription.startDate.toISOString(),
      renewalDate: subscription.renewalDate.toISOString(),
      // Computed server-side so every client shows the same renewal urgency.
      daysUntilRenewal: Math.ceil(
        (subscription.renewalDate.getTime() - Date.now()) / 86_400_000,
      ),
      autoRenew: subscription.autoRenew,
      premiumKobo: Number(subscription.premiumAmount),
      dependants: subscription.dependants.map((d) => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        relationship: d.relationship,
        dateOfBirth: d.dateOfBirth.toISOString().slice(0, 10),
        memberNumberMasked: d.memberNumberEncrypted
          ? maskIdentifier(this.encryption.decrypt(d.memberNumberEncrypted))
          : null,
      })),
    }));
  }

  async subscribe(userId: string, input: SubscribeToPlanInput) {
    const plan = await this.prisma.healthPlan.findUnique({ where: { id: input.planId } });
    if (!plan || !plan.isActive) {
      throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'That plan is not available' });
    }

    if (input.dependants.length > plan.maxDependants) {
      throw new BadRequestException({
        code: 'TOO_MANY_DEPENDANTS',
        message: `The ${plan.name} covers up to ${plan.maxDependants} dependant${plan.maxDependants === 1 ? '' : 's'}`,
      });
    }

    const duplicate = await this.prisma.healthSubscription.findFirst({
      where: { userId, planId: plan.id, status: { in: ['ACTIVE', 'PENDING_PAYMENT', 'GRACE_PERIOD'] } },
    });
    if (duplicate) {
      throw new BadRequestException({
        code: 'ALREADY_SUBSCRIBED',
        message: 'You already have this plan',
      });
    }

    // Premium is multiplied by cycle here rather than trusting a client figure.
    const multiplier = input.billingCycle === 'ANNUAL' ? 12 : input.billingCycle === 'QUARTERLY' ? 3 : 1;
    const premium = plan.premiumAmount * BigInt(multiplier);

    const subscription = await this.prisma.$transaction(
      async (tx) => {
        const transaction = await tx.transaction.create({
          data: {
            reference: `EVS-H${Date.now().toString(36).toUpperCase()}`,
            userId,
            type: 'HEALTH_PREMIUM',
            status: 'SUCCESSFUL',
            channel: input.paymentChannel,
            amount: premium,
            total: premium,
            description: `${plan.name} — ${input.billingCycle.toLowerCase()} premium`,
            completedAt: new Date(),
          },
        });

        if (input.paymentChannel === 'WALLET') {
          await this.wallet.debit(tx, {
            userId,
            amountKobo: premium,
            narration: `${plan.name} premium`,
            transactionId: transaction.id,
          });
        }

        const now = new Date();
        const renewal = new Date(now);
        renewal.setMonth(renewal.getMonth() + multiplier);

        return tx.healthSubscription.create({
          data: {
            userId,
            planId: plan.id,
            status: 'ACTIVE',
            startDate: now,
            renewalDate: renewal,
            autoRenew: input.autoRenew,
            premiumAmount: premium, // snapshot: catalogue price may change later
            billingCycle: input.billingCycle,
            ...(input.primaryHospitalId ? { primaryHospitalId: input.primaryHospitalId } : {}),
            dependants: {
              create: input.dependants.map((d) => ({
                firstName: d.firstName,
                lastName: d.lastName,
                dateOfBirth: new Date(d.dateOfBirth),
                relationship: d.relationship,
                ...(d.gender ? { gender: d.gender } : {}),
              })),
            },
          },
          include: { plan: true },
        });
      },
      { isolationLevel: 'Serializable', timeout: 15_000 },
    );

    await this.notifications.send(userId, {
      category: 'HEALTH',
      title: `${plan.name} is active`,
      body: `Your health cover has started. Your renewal date is ${subscription.renewalDate.toDateString()}.`,
      actionUrl: `/health/${subscription.id}`,
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'health.subscribe',
      resource: 'HealthSubscription',
      resourceId: subscription.id,
      after: { planId: plan.id, billingCycle: input.billingCycle },
    });

    return { id: subscription.id, status: subscription.status };
  }

  async cancel(userId: string, subscriptionId: string, reason: string) {
    const subscription = await this.prisma.healthSubscription.findFirst({
      where: { id: subscriptionId, userId },
    });
    if (!subscription) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Subscription not found' });
    }

    // Cover runs to the end of the paid period — cancelling is switching off
    // renewal, not voiding cover someone has already paid for.
    await this.prisma.healthSubscription.update({
      where: { id: subscriptionId },
      data: {
        autoRenew: false,
        cancelledAt: new Date(),
        cancellationReason: reason,
        endDate: subscription.renewalDate,
      },
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'health.cancel',
      resource: 'HealthSubscription',
      resourceId: subscriptionId,
      reason,
    });

    return {
      message: `Auto-renewal is off. Your cover continues until ${subscription.renewalDate.toDateString()}.`,
    };
  }

  async findHospitals(query: { stateCode?: string; city?: string; hmoProviderId?: string; limit?: number }) {
    return this.prisma.hospital.findMany({
      where: {
        isActive: true,
        ...(query.stateCode ? { stateCode: query.stateCode } : {}),
        ...(query.city ? { city: { contains: query.city, mode: 'insensitive' } } : {}),
        ...(query.hmoProviderId ? { hmoProviderId: query.hmoProviderId } : {}),
      },
      orderBy: { name: 'asc' },
      take: Math.min(query.limit ?? 50, 200),
    });
  }

  private toPlanDto(
    plan: {
      id: string; slug: string; name: string; tier: string; tagline: string | null;
      description: string; premiumAmount: bigint; billingCycle: string; maxDependants: number;
      coverageLimit: bigint | null; waitingPeriodDays: number;
      hmoProvider?: { id: string; name: string; logoUrl: string | null } | null;
      benefits?: Array<{ category: string; title: string; description: string | null; limitLabel: string | null; isIncluded: boolean }>;
    },
    hospitalCount: number,
  ) {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      tier: plan.tier,
      tagline: plan.tagline,
      description: plan.description,
      premiumKobo: Number(plan.premiumAmount),
      billingCycle: plan.billingCycle,
      maxDependants: plan.maxDependants,
      coverageLimitKobo: plan.coverageLimit ? Number(plan.coverageLimit) : null,
      waitingPeriodDays: plan.waitingPeriodDays,
      hmoProvider: plan.hmoProvider
        ? { id: plan.hmoProvider.id, name: plan.hmoProvider.name, logoUrl: plan.hmoProvider.logoUrl }
        : null,
      hospitalCount,
      benefits: plan.benefits ?? [],
    };
  }
}

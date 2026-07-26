import { Injectable, NotFoundException } from '@nestjs/common';
import type { UpdateProfileInput } from '@evas/contracts';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: { include: { state: true, lga: true } }, notificationPrefs: true },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      kycTier: user.kycTier,
      emailVerified: Boolean(user.emailVerifiedAt),
      phoneVerified: Boolean(user.phoneVerifiedAt),
      twoFactorEnabled: user.twoFactorEnabled,
      profile: {
        firstName: user.profile?.firstName ?? '',
        lastName: user.profile?.lastName ?? '',
        middleName: user.profile?.middleName ?? null,
        dateOfBirth: user.profile?.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        gender: user.profile?.gender ?? null,
        avatarUrl: user.profile?.avatarUrl ?? null,
        addressLine1: user.profile?.addressLine1 ?? null,
        addressLine2: user.profile?.addressLine2 ?? null,
        city: user.profile?.city ?? null,
        stateCode: user.profile?.stateCode ?? null,
        stateName: user.profile?.state?.name ?? null,
        lgaCode: user.profile?.lgaCode ?? null,
        lgaName: user.profile?.lga?.name ?? null,
        // Boolean presence only. A profile response is not a place to put a BVN.
        hasBvn: Boolean(user.profile?.bvnEncrypted),
        hasNin: Boolean(user.profile?.ninEncrypted),
      },
      notificationPreferences: user.notificationPrefs
        ? {
            emailEnabled: user.notificationPrefs.emailEnabled,
            smsEnabled: user.notificationPrefs.smsEnabled,
            pushEnabled: user.notificationPrefs.pushEnabled,
            inAppEnabled: user.notificationPrefs.inAppEnabled,
            categoryOverrides: user.notificationPrefs.categoryOverrides,
            quietHoursStart: user.notificationPrefs.quietHoursStart,
            quietHoursEnd: user.notificationPrefs.quietHoursEnd,
            timezone: user.notificationPrefs.timezone,
          }
        : null,
    };
  }

  /**
   * The dashboard aggregate.
   *
   * Everything the landing screen needs, in one round trip and one set of
   * parallel queries. The "recent activity" feed unions transactions and
   * service orders at the application layer rather than in SQL — the two have
   * genuinely different shapes, and a UNION here would need casting that makes
   * the query unindexable.
   */
  async getDashboard(userId: string) {
    const [user, wallet, health, retirement, pension, transactions, unread] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      }),
      this.wallet.getBalance(userId),
      this.prisma.healthSubscription.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { plan: { select: { name: true } } },
        orderBy: { renewalDate: 'asc' },
      }),
      this.prisma.retirementAccount.findUnique({ where: { userId } }),
      this.prisma.pensionAccount.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, reference: true, type: true, status: true, amount: true,
          description: true, createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null, archivedAt: null } }),
    ]);

    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const healthSubscriptionCount = await this.prisma.healthSubscription.count({
      where: { userId, status: { in: ['ACTIVE', 'GRACE_PERIOD'] } },
    });

    const verification = {
      email: Boolean(user.emailVerifiedAt),
      phone: Boolean(user.phoneVerifiedAt),
      bvn: Boolean(user.profile?.bvnEncrypted),
      twoFactor: user.twoFactorEnabled,
    };

    // Weighted by what each step actually unlocks, not by field count.
    const score =
      (verification.email ? 25 : 0) +
      (verification.phone ? 30 : 0) +
      (verification.bvn ? 30 : 0) +
      (verification.twoFactor ? 15 : 0);

    // Surface exactly one next action. A checklist of six things gets ignored;
    // a single "do this next" gets done.
    const nextAction = !verification.email
      ? { label: 'Confirm your email', href: '/settings/security' }
      : !verification.phone
        ? { label: 'Verify your phone number', href: '/settings/security' }
        : !verification.bvn
          ? { label: 'Add your BVN to raise your limits', href: '/settings/identity' }
          : !verification.twoFactor
            ? { label: 'Turn on two-factor authentication', href: '/settings/security' }
            : null;

    const growthPct =
      retirement && retirement.totalContributed > 0n
        ? Number((retirement.totalGrowth * 10_000n) / retirement.totalContributed) / 100
        : 0;

    return {
      user: {
        firstName: user.profile?.firstName ?? '',
        kycTier: user.kycTier,
        profileCompletion: score,
      },
      wallet: {
        balanceKobo: Number(wallet.balanceKobo),
        availableKobo: Number(wallet.availableKobo),
        currency: 'NGN',
        isFrozen: wallet.isFrozen,
      },
      verification: { ...verification, score, nextAction },
      health: {
        subscriptionCount: healthSubscriptionCount,
        activePlanName: health?.plan.name ?? null,
        daysUntilRenewal: health
          ? Math.ceil((health.renewalDate.getTime() - Date.now()) / 86_400_000)
          : null,
      },
      retirement: {
        balanceKobo: retirement ? Number(retirement.balance) : 0,
        growthPct,
        hasPension: Boolean(pension),
      },
      recentActivity: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.description,
        subtitle: t.reference,
        amountKobo: Number(t.amount),
        status: t.status,
        createdAt: t.createdAt.toISOString(),
      })),
      unreadNotifications: unread,
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const before = await this.prisma.profile.findUnique({ where: { userId } });
    if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Profile not found' });

    // Zod has already stripped anything not in the schema, so a client cannot
    // smuggle kycTier or bvnEncrypted into this update.
    const profile = await this.prisma.profile.update({
      where: { userId },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.middleName !== undefined ? { middleName: input.middleName } : {}),
        ...(input.dateOfBirth !== undefined ? { dateOfBirth: new Date(input.dateOfBirth) } : {}),
        ...(input.gender !== undefined ? { gender: input.gender } : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
        ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.stateCode !== undefined ? { stateCode: input.stateCode } : {}),
        ...(input.lgaCode !== undefined ? { lgaCode: input.lgaCode } : {}),
      },
    });

    const { before: changedBefore, after: changedAfter } = this.audit.diff(
      before as unknown as Record<string, unknown>,
      input as Record<string, unknown>,
    );
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'user.profile.update',
      resource: 'Profile',
      resourceId: profile.id,
      before: changedBefore,
      after: changedAfter,
    });

    return this.getProfile(userId);
  }

  async updateNotificationPreferences(
    userId: string,
    input: {
      emailEnabled: boolean;
      smsEnabled: boolean;
      pushEnabled: boolean;
      inAppEnabled: boolean;
      categoryOverrides?: Record<string, unknown>;
      quietHoursStart?: string | null;
      quietHoursEnd?: string | null;
      timezone?: string;
    },
  ) {
    // SECURITY is not an overridable category — the schema omits it, and this
    // strips it defensively in case a future schema change lets it through.
    const overrides = { ...(input.categoryOverrides ?? {}) };
    delete overrides.SECURITY;

    const data = {
      emailEnabled: input.emailEnabled,
      smsEnabled: input.smsEnabled,
      pushEnabled: input.pushEnabled,
      inAppEnabled: input.inAppEnabled,
      categoryOverrides: overrides as never,
      quietHoursStart: input.quietHoursStart ?? null,
      quietHoursEnd: input.quietHoursEnd ?? null,
      timezone: input.timezone ?? 'Africa/Lagos',
    };

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getProfile(userId);
  }

  /** Reference data for the address form. Cached hard — it changes never. */
  async listStates() {
    return this.prisma.state.findMany({
      orderBy: { name: 'asc' },
      include: { lgas: { orderBy: { name: 'asc' }, select: { code: true, name: true } } },
    });
  }
}

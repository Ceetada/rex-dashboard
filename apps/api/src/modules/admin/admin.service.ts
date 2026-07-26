import { Injectable, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';

import { AuditService } from '../../common/audit/audit.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Dashboard metrics.
   *
   * Deliberately a handful of aggregate queries rather than one clever join:
   * they run in parallel, each hits an index, and none of them scans the
   * transaction table. At a million users the naive version of this endpoint is
   * the first thing to fall over.
   */
  async metrics(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);

    const [totalUsers, activeUsers, newUsers, volume, byStatus, byType, pendingReconciliation, openTickets] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: since } } }),
        this.prisma.user.count({ where: { createdAt: { gte: since } } }),
        this.prisma.transaction.aggregate({
          where: { status: 'SUCCESSFUL', createdAt: { gte: since } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.transaction.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        this.prisma.transaction.groupBy({
          by: ['type'],
          where: { status: 'SUCCESSFUL', createdAt: { gte: since } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.serviceOrder.count({ where: { status: 'REQUIRES_RECONCILIATION' } }),
        this.prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      ]);

    return {
      periodDays: days,
      users: { total: totalUsers, active: activeUsers, new: newUsers },
      transactions: {
        volumeKobo: Number(volume._sum.amount ?? 0n),
        count: volume._count._all,
        byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
        byType: byType.map((t) => ({
          type: t.type,
          count: t._count._all,
          volumeKobo: Number(t._sum.amount ?? 0n),
        })),
      },
      operations: { pendingReconciliation, openTickets },
    };
  }

  async listUsers(query: { search?: string; status?: string; cursor?: string; limit: number }) {
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.search
          ? {
              OR: [
                { email: { contains: query.search, mode: 'insensitive' as const } },
                { phone: { contains: query.search } },
                { profile: { firstName: { contains: query.search, mode: 'insensitive' as const } } },
                { profile: { lastName: { contains: query.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { profile: { select: { firstName: true, lastName: true } } },
    });

    const hasMore = users.length > query.limit;
    const page = hasMore ? users.slice(0, query.limit) : users;

    return {
      // Note what is absent: no BVN, no NIN, not even encrypted. A staff list
      // view has no business carrying government identifiers.
      data: page.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        name: `${u.profile?.firstName ?? ''} ${u.profile?.lastName ?? ''}`.trim(),
        status: u.status,
        kycTier: u.kycTier,
        emailVerified: Boolean(u.emailVerifiedAt),
        phoneVerified: Boolean(u.phoneVerifiedAt),
        twoFactorEnabled: u.twoFactorEnabled,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async userDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        wallet: true,
        roles: { include: { role: true } },
        healthSubscriptions: { include: { plan: { select: { name: true } } } },
        devices: { where: { revokedAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 10 },
      },
    });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      status: user.status,
      kycTier: user.kycTier,
      profile: user.profile
        ? {
            firstName: user.profile.firstName,
            lastName: user.profile.lastName,
            dateOfBirth: user.profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
            gender: user.profile.gender,
            city: user.profile.city,
            stateCode: user.profile.stateCode,
            // Presence, never the value. Support needs to know whether a BVN is
            // on file; it does not need to know what it is.
            hasBvn: Boolean(user.profile.bvnEncrypted),
            hasNin: Boolean(user.profile.ninEncrypted),
          }
        : null,
      wallet: user.wallet
        ? { balanceKobo: Number(user.wallet.balance), isFrozen: user.wallet.isFrozen }
        : null,
      roles: user.roles.map((r) => r.role.name),
      healthSubscriptions: user.healthSubscriptions.map((s) => ({
        id: s.id,
        planName: s.plan.name,
        status: s.status,
        renewalDate: s.renewalDate.toISOString(),
      })),
      devices: user.devices.map((d) => ({
        id: d.id,
        name: d.name,
        trusted: d.trusted,
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
      createdAt: user.createdAt.toISOString(),
    };
  }

  async setUserStatus(
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    actorId: string,
    reason: string,
    request: Request,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const user = await this.prisma.user.update({ where: { id }, data: { status } });

    // Suspension has to actually end the user's access. Flipping a status
    // column while their 15-minute access token stays valid is a suspension in
    // name only, so every session is revoked too.
    if (status === 'SUSPENDED') {
      await this.tokens.revokeAllSessions(id, `ADMIN_SUSPENSION: ${reason}`);
    }

    await this.audit.record({
      actorId,
      actorType: 'ADMIN',
      action: status === 'SUSPENDED' ? 'admin.user.suspend' : 'admin.user.reinstate',
      resource: 'User',
      resourceId: id,
      before: { status: before.status },
      after: { status },
      reason,
      ipHash: this.encryption.hashIp(request.ip ?? 'unknown'),
      requestId: (request as Request & { requestId?: string }).requestId,
    });

    await this.notifications
      .send(id, {
        category: 'SECURITY',
        title: status === 'SUSPENDED' ? 'Your account has been suspended' : 'Your account is active again',
        body:
          status === 'SUSPENDED'
            ? 'Your Evas account has been suspended. Contact support if you believe this is a mistake.'
            : 'Your Evas account has been reinstated. You can sign in again.',
      })
      .catch(() => undefined);

    return { id: user.id, status: user.status };
  }

  async setKycTier(id: string, tier: string, actorId: string, reason: string, request: Request) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const user = await this.prisma.user.update({
      where: { id },
      data: { kycTier: tier as never },
    });

    await this.audit.record({
      actorId,
      actorType: 'ADMIN',
      action: 'admin.user.kyc_tier',
      resource: 'User',
      resourceId: id,
      before: { kycTier: before.kycTier },
      after: { kycTier: tier },
      reason,
      ipHash: this.encryption.hashIp(request.ip ?? 'unknown'),
    });

    return { id: user.id, kycTier: user.kycTier };
  }

  async listTransactions(query: { status?: string; type?: string; cursor?: string; limit: number }) {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.type ? { type: query.type as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { user: { select: { email: true } } },
    });

    const hasMore = transactions.length > query.limit;
    const page = hasMore ? transactions.slice(0, query.limit) : transactions;

    return {
      data: page.map((t) => ({
        id: t.id,
        reference: t.reference,
        userEmail: t.user.email,
        type: t.type,
        status: t.status,
        channel: t.channel,
        amountKobo: Number(t.amount),
        description: t.description,
        failureReason: t.failureReason,
        createdAt: t.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async reconciliationQueue() {
    const orders = await this.prisma.serviceOrder.findMany({
      where: { status: 'REQUIRES_RECONCILIATION' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      include: { user: { select: { email: true } }, provider: { select: { slug: true } } },
    });
    return orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      userEmail: o.user.email,
      serviceType: o.serviceType,
      provider: o.provider?.slug ?? null,
      recipientMasked: o.recipientMasked,
      amountKobo: Number(o.amount),
      attemptCount: o.attemptCount,
      failureReason: o.failureReason,
      // How long a user's money has been in limbo — the sort key operations
      // actually cares about.
      ageMinutes: Math.floor((Date.now() - o.createdAt.getTime()) / 60_000),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async createAnnouncement(
    actorId: string,
    input: { title: string; message: string; channels?: string[]; audience?: Record<string, unknown> },
  ) {
    const announcement = await this.prisma.announcement.create({
      data: {
        title: input.title,
        body: input.message,
        channels: (input.channels ?? ['IN_APP']) as never,
        audience: (input.audience ?? {}) as never,
        createdById: actorId,
      },
    });

    await this.audit.record({
      actorId,
      actorType: 'ADMIN',
      action: 'admin.announcement.create',
      resource: 'Announcement',
      resourceId: announcement.id,
      after: { title: input.title },
    });

    // Fan-out is a background job, not part of this request: writing a
    // Notification row per user inline would time out on any real audience.
    return { id: announcement.id, status: 'QUEUED' };
  }

  async listAuditLogs(query: {
    actorId?: string;
    resource?: string;
    action?: string;
    cursor?: string;
    limit: number;
  }) {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.resource ? { resource: query.resource } : {}),
        ...(query.action ? { action: { startsWith: query.action } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { actor: { select: { email: true } } },
    });

    const hasMore = logs.length > query.limit;
    const page = hasMore ? logs.slice(0, query.limit) : logs;

    return {
      data: page.map((l) => ({
        id: l.id,
        actorEmail: l.actor?.email ?? 'system',
        actorType: l.actorType,
        action: l.action,
        resource: l.resource,
        resourceId: l.resourceId,
        outcome: l.outcome,
        reason: l.reason,
        before: l.before,
        after: l.after,
        createdAt: l.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }
}

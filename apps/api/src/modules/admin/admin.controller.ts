import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { AuditService } from '../../common/audit/audit.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';
import { AdminService } from './admin.service';

/**
 * Administration portal.
 *
 * Every route declares the exact permission it needs. Nothing here is guarded
 * by "is this person an admin?" — that coarse check is what lets a support
 * agent who only needed to read a ticket also suspend an account.
 *
 * Every mutation is audit-logged with the actor, the before/after values and a
 * required reason. An admin action without a recorded reason is not something
 * this system permits.
 */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly registry: ProviderRegistry,
  ) {}

  @Get('metrics')
  @RequirePermissions('analytics:read')
  metrics(@Query('days') days = '30') {
    return this.admin.metrics(Math.min(Number(days) || 30, 365));
  }

  @Get('users')
  @RequirePermissions('user:read')
  users(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '25',
  ) {
    return this.admin.listUsers({
      search,
      status,
      cursor,
      limit: Math.min(Number(limit) || 25, 100),
    });
  }

  @Get('users/:id')
  @RequirePermissions('user:read')
  async userDetail(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Req() request: Request,
  ) {
    // Reading a customer's full record is itself a privileged action under
    // NDPA — "which staff member looked at my data?" must be answerable, so
    // the read is logged, not just the writes.
    await this.audit.record({
      actorId,
      actorType: 'ADMIN',
      action: 'admin.user.read',
      resource: 'User',
      resourceId: id,
      ipHash: this.encryption.hashIp(request.ip ?? 'unknown'),
      requestId: (request as Request & { requestId?: string }).requestId,
    });
    return this.admin.userDetail(id);
  }

  @Patch('users/:id/suspend')
  @RequirePermissions('user:suspend')
  suspend(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Body('reason') reason: string,
    @Req() request: Request,
  ) {
    return this.admin.setUserStatus(id, 'SUSPENDED', actorId, reason, request);
  }

  @Patch('users/:id/reinstate')
  @RequirePermissions('user:suspend')
  reinstate(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Body('reason') reason: string,
    @Req() request: Request,
  ) {
    return this.admin.setUserStatus(id, 'ACTIVE', actorId, reason, request);
  }

  @Patch('users/:id/verify')
  @RequirePermissions('user:verify')
  verify(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Body('tier') tier: string,
    @Body('reason') reason: string,
    @Req() request: Request,
  ) {
    return this.admin.setKycTier(id, tier, actorId, reason, request);
  }

  @Get('transactions')
  @RequirePermissions('transaction:read')
  transactions(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '25',
  ) {
    return this.admin.listTransactions({
      status,
      type,
      cursor,
      limit: Math.min(Number(limit) || 25, 100),
    });
  }

  /** The queue that matters operationally: money in limbo. */
  @Get('reconciliation')
  @RequirePermissions('transaction:read')
  reconciliationQueue() {
    return this.admin.reconciliationQueue();
  }

  @Post('announcements')
  @RequirePermissions('announcement:create')
  announce(
    @CurrentUser('sub') actorId: string,
    @Body() body: { title: string; message: string; channels?: string[]; audience?: Record<string, unknown> },
  ) {
    return this.admin.createAnnouncement(actorId, body);
  }

  @Get('providers/health')
  @RequirePermissions('provider:read')
  async providerHealth() {
    const configured = await this.prisma.provider.findMany({
      orderBy: [{ category: 'asc' }, { priority: 'asc' }],
    });
    const breakers = new Map(this.registry.snapshot().map((s) => [s.slug, s]));
    return configured.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      status: p.status,
      priority: p.priority,
      failureCount: p.failureCount,
      healthyAt: p.healthyAt?.toISOString() ?? null,
      circuitOpen: breakers.get(p.slug)?.open ?? false,
    }));
  }

  @Get('audit-logs')
  @RequirePermissions('audit:read')
  auditLogs(
    @Query('actorId') actorId?: string,
    @Query('resource') resource?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    return this.admin.listAuditLogs({
      actorId,
      resource,
      action,
      cursor,
      limit: Math.min(Number(limit) || 50, 200),
    });
  }
}

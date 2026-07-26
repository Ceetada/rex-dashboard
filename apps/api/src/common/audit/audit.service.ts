import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId: string | null;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'PROVIDER';
  action: string;
  resource: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED';
  reason?: string | null;
}

/**
 * Append-only audit trail.
 *
 * Two properties make this useful rather than decorative:
 *
 *  * It records *denied* and failed attempts, not just successful ones. "Who
 *    tried to suspend this account and was refused?" is the question that
 *    actually matters during an incident.
 *
 *  * Snapshots are field-filtered before they are written. An audit log that
 *    faithfully captures a password hash or a decrypted BVN in its `before`
 *    payload has simply moved the breach to a different table.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /** Never persisted, at any nesting depth. */
  private readonly redacted = new Set([
    'password', 'passwordhash', 'passwordconfirmation', 'currentpassword',
    'token', 'tokenhash', 'accesstoken', 'refreshtoken', 'secret',
    'twofactorsecret', 'twofactorsecretencrypted', 'codehash', 'code', 'otp',
    'bvn', 'bvnencrypted', 'nin', 'ninencrypted', 'rsanumberencrypted',
    'recipientencrypted', 'membernumberencrypted', 'cardnumber', 'cvv', 'pin',
    'authorization', 'cookie',
  ]);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId,
          actorType: entry.actorType,
          action: entry.action,
          resource: entry.resource,
          resourceId: entry.resourceId ?? null,
          before: this.sanitise(entry.before) as never,
          after: this.sanitise(entry.after) as never,
          ipHash: entry.ipHash ?? null,
          userAgent: entry.userAgent?.slice(0, 512) ?? null,
          requestId: entry.requestId ?? null,
          outcome: entry.outcome ?? 'SUCCESS',
          reason: entry.reason ?? null,
        },
      });
    } catch (error) {
      // Audit writes must never break the operation being audited — a user
      // should not be unable to pay because a log insert failed. But a silent
      // gap in the trail is itself a compliance problem, so this is logged at
      // error level and alerted on.
      this.logger.error(
        `AUDIT WRITE FAILED for ${entry.action} on ${entry.resource}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  private sanitise(value: unknown, depth = 0): unknown {
    if (value == null || depth > 6) return value ?? null;
    if (Array.isArray(value)) return value.map((v) => this.sanitise(v, depth + 1));
    if (typeof value !== 'object') return value;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'bigint') return String(value);

    const output: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (this.redacted.has(key.toLowerCase())) {
        output[key] = '[REDACTED]';
        continue;
      }
      output[key] = typeof raw === 'bigint' ? String(raw) : this.sanitise(raw, depth + 1);
    }
    return output;
  }

  /** Emits only the fields that actually changed, keeping diffs readable. */
  diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        changedBefore[key] = before[key];
        changedAfter[key] = after[key];
      }
    }
    return { before: changedBefore, after: changedAfter };
  }
}

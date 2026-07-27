import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { AnyAdapter, ProviderCategory } from './provider.types';

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

/**
 * Resolves which adapter handles a given request, and stops sending traffic to
 * one that is failing.
 *
 * Nigerian VTU aggregators have genuinely bad availability — month-end and
 * salary-day congestion routinely takes one offline for tens of minutes. A
 * platform with a single hard-coded integration simply stops selling airtime
 * during those windows. Registering several adapters per category and failing
 * over on the fly is the difference between degraded and down.
 *
 * The breaker is deliberately simple: N consecutive failures opens it for a
 * cool-off, after which one request is allowed through to test the water
 * (half-open). Anything more elaborate is hard to reason about at 2am.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly adapters = new Map<string, AnyAdapter>();
  private readonly breakers = new Map<string, BreakerState>();

  private readonly failureThreshold = 5;
  private readonly cooldownMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /** Adapters self-register at module init. */
  register(adapter: AnyAdapter): void {
    this.adapters.set(adapter.slug, adapter);
    this.logger.log(`Registered ${adapter.category} adapter: ${adapter.slug}`);
  }

  get<T extends AnyAdapter>(slug: string): T {
    const adapter = this.adapters.get(slug);
    if (!adapter) throw new Error(`No adapter registered for provider "${slug}"`);
    return adapter as T;
  }

  /**
   * Picks the highest-priority healthy adapter for a category.
   * `preferSlug` lets a caller pin a provider (an HMO enrolment must go to the
   * HMO that actually sold the plan — failover is meaningless there).
   */
  async resolve<T extends AnyAdapter>(
    category: ProviderCategory,
    preferSlug?: string,
  ): Promise<{ adapter: T; providerId: string }> {
    if (preferSlug) {
      const provider = await this.prisma.provider.findUnique({ where: { slug: preferSlug } });
      if (!provider || provider.status === 'DISABLED') {
        throw new ServiceUnavailableException({
          code: 'PROVIDER_UNAVAILABLE',
          message: 'This service is temporarily unavailable. Please try again shortly.',
        });
      }
      return { adapter: this.get<T>(preferSlug), providerId: provider.id };
    }

    const candidates = await this.prisma.provider.findMany({
      where: { category, status: { not: 'DISABLED' } },
      orderBy: [{ status: 'asc' }, { priority: 'asc' }],
    });

    for (const candidate of candidates) {
      if (!this.adapters.has(candidate.slug)) continue;
      if (this.isOpen(candidate.slug)) {
        this.logger.warn(`Skipping ${candidate.slug}: circuit open`);
        continue;
      }
      return { adapter: this.get<T>(candidate.slug), providerId: candidate.id };
    }

    // Every provider in this category is down. Surfacing this as 503 rather
    // than 500 matters: it tells the client to retry rather than give up.
    throw new ServiceUnavailableException({
      code: 'NO_PROVIDER_AVAILABLE',
      message: 'This service is temporarily unavailable. Please try again shortly.',
    });
  }

  /**
   * Runs a call through the breaker.
   *
   * Note what is *not* counted as a failure: a provider cleanly rejecting a
   * request (insufficient balance, invalid number) means the integration is
   * working perfectly. Only transport-level errors trip the breaker.
   */
  async execute<T>(slug: string, operation: () => Promise<T>): Promise<T> {
    if (this.isOpen(slug)) {
      throw new ServiceUnavailableException({
        code: 'PROVIDER_CIRCUIT_OPEN',
        message: 'This service is temporarily unavailable. Please try again shortly.',
      });
    }
    try {
      const result = await operation();
      await this.recordSuccess(slug);
      return result;
    } catch (error) {
      await this.recordFailure(slug);
      throw error;
    }
  }

  private isOpen(slug: string): boolean {
    const breaker = this.breakers.get(slug);
    if (!breaker?.openedAt) return false;
    if (Date.now() - breaker.openedAt > this.cooldownMs) {
      // Half-open: let the next call through and judge by its result.
      breaker.openedAt = null;
      breaker.failures = this.failureThreshold - 1;
      return false;
    }
    return true;
  }

  private async recordSuccess(slug: string): Promise<void> {
    this.breakers.set(slug, { failures: 0, openedAt: null });
    await this.prisma.provider
      .update({
        where: { slug },
        data: { healthyAt: new Date(), failureCount: 0, status: 'ACTIVE' },
      })
      .catch(() => undefined); // health bookkeeping must never fail a user request
  }

  private async recordFailure(slug: string): Promise<void> {
    const breaker = this.breakers.get(slug) ?? { failures: 0, openedAt: null };
    breaker.failures += 1;
    if (breaker.failures >= this.failureThreshold) {
      breaker.openedAt = Date.now();
      this.logger.error(`Circuit opened for ${slug} after ${breaker.failures} failures`);
    }
    this.breakers.set(slug, breaker);

    await this.prisma.provider
      .update({
        where: { slug },
        data: {
          failureCount: breaker.failures,
          status: breaker.openedAt ? 'DEGRADED' : undefined,
        },
      })
      .catch(() => undefined);
  }

  /** Exposed for the admin provider-health screen. */
  snapshot(): Array<{ slug: string; failures: number; open: boolean }> {
    return [...this.adapters.keys()].map((slug) => ({
      slug,
      failures: this.breakers.get(slug)?.failures ?? 0,
      open: this.isOpen(slug),
    }));
  }
}

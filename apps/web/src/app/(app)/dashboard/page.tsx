import { ArrowRight, Bell, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { Metadata } from 'next';

import { BalanceCard, StatTile } from '@/components/dashboard/balance-card';
import { FeatureCards } from '@/components/dashboard/feature-cards';
import { RecentActivity } from '@/components/dashboard/recent-activity';
import { VerificationRing } from '@/components/dashboard/verification-ring';
import { Button } from '@/components/ui/button';
import { getDashboard } from '@/lib/queries';
import { formatBalance, greeting } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };

/**
 * The dashboard.
 *
 * Rendered on the server from one aggregate call. The ordering below is a
 * deliberate hierarchy rather than a list of available widgets:
 *
 *   1. Balance — the single number people open the app to check.
 *   2. Next verification step — the one action that unlocks everything else.
 *   3. The five modules — the actual product.
 *   4. Summaries and recent activity — reassurance, not primary navigation.
 *
 * Anything that would push the balance below the fold on a small phone belongs
 * further down the page.
 */
export default async function DashboardPage() {
  const data = await getDashboard();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <p className="text-body-sm text-content-muted">{greeting()},</p>
        <h1 className="text-display-sm text-content">{data.user.firstName || 'there'}</h1>
      </header>

      <section aria-labelledby="wallet-heading" className="flex flex-col gap-4">
        <h2 id="wallet-heading" className="sr-only">
          Wallet
        </h2>
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <BalanceCard
            balanceKobo={data.wallet.balanceKobo}
            availableKobo={data.wallet.availableKobo}
            isFrozen={data.wallet.isFrozen}
          />

          {/*
            Verification is framed as one next step with a progress ring, not a
            checklist of six items. A checklist gets dismissed; a single
            prompt with visible progress gets completed.
          */}
          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-line-subtle bg-surface p-6">
            <div className="flex items-start gap-4">
              <VerificationRing score={data.verification.score} />
              <div className="min-w-0">
                <h3 className="text-heading-sm text-content">Account setup</h3>
                <p className="mt-0.5 text-body-sm text-content-muted">
                  {data.verification.score === 100
                    ? 'Everything is verified. Your account is fully unlocked.'
                    : 'Finish setting up to raise your limits.'}
                </p>
              </div>
            </div>

            {data.verification.nextAction ? (
              <Button asChild variant="secondary" size="sm" fullWidth>
                <Link href={data.verification.nextAction.href}>
                  {data.verification.nextAction.label}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : (
              <p className="flex items-center gap-2 text-body-sm text-success-fg">
                <ShieldCheck className="size-4" aria-hidden />
                Fully verified
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="services-heading" className="flex flex-col gap-4">
        <h2 id="services-heading" className="text-heading-md text-content">
          What would you like to do?
        </h2>
        <FeatureCards
          healthStatus={
            data.health.activePlanName
              ? `${data.health.activePlanName} · renews in ${data.health.daysUntilRenewal} days`
              : undefined
          }
          retirementStatus={
            data.retirement.balanceKobo > 0
              ? `${formatBalance(data.retirement.balanceKobo)} saved`
              : undefined
          }
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section aria-labelledby="summary-heading" className="flex flex-col gap-4">
          <h2 id="summary-heading" className="text-heading-md text-content">
            Your accounts
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <StatTile
              label="Retirement savings"
              value={formatBalance(data.retirement.balanceKobo)}
              delta={
                data.retirement.growthPct !== 0
                  ? {
                      value: `${data.retirement.growthPct > 0 ? '+' : ''}${data.retirement.growthPct.toFixed(1)}% growth`,
                      positive: data.retirement.growthPct > 0,
                    }
                  : undefined
              }
              href="/retirement"
            />
            <StatTile
              label="Health plans"
              value={String(data.health.subscriptionCount)}
              href="/health"
            />
          </div>
        </section>

        <section aria-labelledby="activity-heading" className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 id="activity-heading" className="text-heading-md text-content">
              Recent activity
            </h2>
            <Button asChild variant="link" size="sm">
              <Link href="/transactions">View all</Link>
            </Button>
          </div>
          <RecentActivity items={data.recentActivity} />
        </section>
      </div>

      {data.unreadNotifications > 0 && (
        <Link
          href="/notifications"
          className="flex items-center gap-3 rounded-xl border border-line-subtle bg-surface p-4 transition-colors duration-fast hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent-subtle text-content">
            <Bell className="size-4" aria-hidden />
          </span>
          <p className="text-body-sm text-content">
            You have{' '}
            <strong className="font-semibold">
              {data.unreadNotifications} unread notification
              {data.unreadNotifications === 1 ? '' : 's'}
            </strong>
          </p>
          <ArrowRight className="ml-auto size-4 text-content-muted" aria-hidden />
        </Link>
      )}
    </div>
  );
}

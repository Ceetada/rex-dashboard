import { Check, Minus, Users } from 'lucide-react';
import type { Metadata } from 'next';
import type { HealthPlanDto, HealthSubscriptionDto } from '@evas/contracts';

import { Badge, statusTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHealthPlans, getHealthSubscriptions, optional } from '@/lib/queries';
import { formatBalance, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { title: 'Health plans' };

/**
 * Health plans.
 *
 * The page renders whatever the catalogue returns — there is no switch on plan
 * tier anywhere in this file. A fourth plan appears simply by existing in the
 * database, which is what "design this to support additional plans" has to mean
 * in practice rather than in principle.
 */
export default async function HealthPage() {
  const [plans, subscriptions] = await Promise.all([
    getHealthPlans(),
    // Tolerant: a signed-out visitor still gets the public catalogue. optional()
    // keeps an expired session redirecting to sign-in instead of silently
    // rendering "no cover".
    optional(getHealthSubscriptions, [] as HealthSubscriptionDto[]),
  ]);

  const subscribedPlanIds = new Set(subscriptions.map((s) => s.plan.id));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-sm text-content">Health plans</h1>
        <p className="text-body-md text-content-muted">
          Cover for you and the people who depend on you.
        </p>
      </header>

      {subscriptions.length > 0 && (
        <section aria-labelledby="active-heading" className="flex flex-col gap-4">
          <h2 id="active-heading" className="text-heading-md text-content">
            Your cover
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {subscriptions.map((subscription) => (
              <ActiveSubscriptionCard key={subscription.id} subscription={subscription} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="plans-heading" className="flex flex-col gap-4">
        <h2 id="plans-heading" className="text-heading-md text-content">
          {subscriptions.length > 0 ? 'Other plans' : 'Choose a plan'}
        </h2>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} subscribed={subscribedPlanIds.has(plan.id)} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ActiveSubscriptionCard({ subscription }: { subscription: HealthSubscriptionDto }) {
  const { tone, label } = statusTone(subscription.status);
  // Renewal urgency is a real deadline for the user, so it is escalated
  // visually inside 30 days rather than being buried in a date field.
  const renewingSoon = subscription.daysUntilRenewal <= 30;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{subscription.plan.name}</CardTitle>
            {subscription.memberNumberMasked && (
              <p className="mt-1 font-mono text-caption text-content-muted">
                Member {subscription.memberNumberMasked}
              </p>
            )}
          </div>
          <Badge tone={tone}>{label}</Badge>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-overline uppercase text-content-muted">Premium</dt>
            <dd className="mt-0.5 text-body-md font-semibold text-content tabular-nums">
              {formatBalance(subscription.premiumKobo)}
              <span className="font-normal text-content-muted">
                /{subscription.plan.billingCycle.toLowerCase().replace('ly', '')}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-overline uppercase text-content-muted">Renews</dt>
            <dd
              className={cn(
                'mt-0.5 text-body-md font-semibold',
                renewingSoon ? 'text-warning-fg' : 'text-content',
              )}
            >
              {formatDate(subscription.renewalDate)}
              {renewingSoon && (
                <span className="block text-caption font-normal">
                  in {subscription.daysUntilRenewal} days
                </span>
              )}
            </dd>
          </div>
        </dl>

        {subscription.dependants.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-subtle px-3 py-2.5">
            <Users className="size-4 shrink-0 text-content-muted" aria-hidden />
            <p className="text-body-sm text-content">
              {subscription.dependants.length} dependant
              {subscription.dependants.length === 1 ? '' : 's'} covered
              <span className="text-content-muted">
                {' — '}
                {subscription.dependants.map((d) => d.firstName).join(', ')}
              </span>
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href={`/health/${subscription.id}`}>Manage</a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`/health/${subscription.id}/hospitals`}>Find a hospital</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlanCard({ plan, subscribed }: { plan: HealthPlanDto; subscribed: boolean }) {
  // The mid-tier plan is highlighted rather than the most expensive one —
  // the goal is to guide toward the right fit, not to upsell the top plan.
  const highlighted = plan.tier === 'FAMILY';
  const included = plan.benefits.filter((b) => b.isIncluded);
  const excluded = plan.benefits.filter((b) => !b.isIncluded);

  return (
    <Card
      className={cn(
        'flex flex-col',
        highlighted && 'border-[var(--color-border-primary)] shadow-md ring-1 ring-[var(--color-border-primary)]',
      )}
    >
      <CardHeader className="gap-3">
        {highlighted && (
          <Badge tone="brand" className="w-fit">
            Most popular
          </Badge>
        )}
        <div>
          <CardTitle className="text-heading-md">{plan.name}</CardTitle>
          {plan.tagline && (
            <p className="mt-1 text-body-sm text-content-muted">{plan.tagline}</p>
          )}
        </div>

        <p className="flex items-baseline gap-1">
          <span className="text-numeric text-content tabular-nums" data-numeric>
            {formatBalance(plan.premiumKobo)}
          </span>
          <span className="text-body-sm text-content-muted">
            /{plan.billingCycle.toLowerCase().replace('ly', '')}
          </span>
        </p>

        <div className="flex flex-wrap gap-3 text-caption text-content-muted">
          {plan.maxDependants > 0 && <span>Up to {plan.maxDependants} dependants</span>}
          {plan.hospitalCount > 0 && <span>{plan.hospitalCount}+ hospitals</span>}
          <span>
            {plan.coverageLimitKobo
              ? `${formatBalance(plan.coverageLimitKobo)} annual limit`
              : 'No annual limit'}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-4">
        <ul className="flex flex-col gap-2.5">
          {included.map((benefit) => (
            <li key={benefit.title} className="flex items-start gap-2.5 text-body-sm">
              <Check
                className="mt-0.5 size-4 shrink-0 text-success-fg"
                aria-hidden
              />
              <span className="text-content">
                {benefit.title}
                {benefit.limitLabel && (
                  <span className="text-content-muted"> — {benefit.limitLabel}</span>
                )}
              </span>
            </li>
          ))}
          {/*
            What is *not* covered is shown, not hidden. A plan page that lists
            only inclusions leaves people to discover exclusions at a hospital
            counter, which is the worst possible moment.
          */}
          {excluded.map((benefit) => (
            <li
              key={benefit.title}
              className="flex items-start gap-2.5 text-body-sm text-content-muted"
            >
              <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{benefit.title}</span>
            </li>
          ))}
        </ul>

        <div className="mt-auto pt-2">
          {subscribed ? (
            <Button variant="secondary" fullWidth disabled>
              Already subscribed
            </Button>
          ) : (
            <Button asChild variant={highlighted ? 'primary' : 'secondary'} fullWidth>
              <a href={`/health/subscribe/${plan.slug}`}>Choose {plan.name}</a>
            </Button>
          )}
          {plan.waitingPeriodDays > 0 && (
            <p className="mt-2 text-center text-caption text-content-muted">
              {plan.waitingPeriodDays}-day waiting period applies
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

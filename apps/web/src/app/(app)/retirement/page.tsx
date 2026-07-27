import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import type { PensionAccountDto, RetirementAccountDto } from '@evas/contracts';

import { ContributionChart } from '@/components/retirement/contribution-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getPension, getRetirement } from '@/lib/queries';
import { formatBalance, formatDate, relativeTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Retirement' };

/**
 * Retirement.
 *
 * The page keeps two things visually distinct because they are legally
 * distinct: voluntary savings we administer, and the statutory RSA the user's
 * PFA administers. Presenting them as one balance would imply we control money
 * we do not, so the pension section is explicitly attributed and timestamped.
 */
export default async function RetirementPage() {
  const [savings, pension] = await Promise.all([
    getRetirement().catch(() => null),
    getPension().catch(() => null),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-display-sm text-content">Retirement</h1>
        <p className="text-body-md text-content-muted">
          Your savings with Evas, and your statutory pension.
        </p>
      </header>

      {savings ? <SavingsSection savings={savings} /> : <EmptySavings />}
      {pension && <PensionSection pension={pension} />}
    </div>
  );
}

function SavingsSection({ savings }: { savings: RetirementAccountDto }) {
  return (
    <section aria-labelledby="savings-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="savings-heading" className="text-heading-md text-content">
          Retirement savings
        </h2>
        <Button asChild size="sm">
          <a href="/retirement/contribute">Add money</a>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="sm:col-span-1">
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Balance</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(savings.balanceKobo)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Contributed</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(savings.totalContributedKobo)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Growth</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(savings.totalGrowthKobo)}
            </p>
            {savings.growthPct !== 0 && (
              <p className="mt-0.5 text-caption text-success-fg">
                +{savings.growthPct.toFixed(1)}% on contributions
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {savings.targetAmountKobo && savings.targetProgressPct !== null && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-body-sm font-medium text-content">
                Target: {formatBalance(savings.targetAmountKobo)}
                {savings.targetDate && (
                  <span className="font-normal text-content-muted">
                    {' '}by {formatDate(savings.targetDate)}
                  </span>
                )}
              </p>
              <p className="text-body-sm font-semibold text-content tabular-nums">
                {savings.targetProgressPct}%
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={savings.targetProgressPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress toward your retirement target"
              className="h-2 overflow-hidden rounded-full bg-subtle"
            >
              <div
                className="h-full rounded-full bg-[var(--color-bg-primary)] transition-[width] duration-slow ease-standard"
                style={{ width: `${savings.targetProgressPct}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {savings.monthlySeries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Balance over time</CardTitle>
          </CardHeader>
          <CardContent>
            <ContributionChart data={savings.monthlySeries} />
          </CardContent>
        </Card>
      )}

      {savings.holdings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>How your money is invested</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-4">
              {savings.holdings.map((holding) => (
                <li key={holding.instrument} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-body-sm text-content">{holding.instrument}</span>
                    <span className="text-body-sm font-medium text-content tabular-nums">
                      {formatBalance(holding.currentValueKobo)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                      <div
                        className="h-full rounded-full bg-[var(--palette-green-500)]"
                        style={{ width: `${holding.allocationPct}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right text-caption text-content-muted tabular-nums">
                      {holding.allocationPct}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function PensionSection({ pension }: { pension: PensionAccountDto }) {
  return (
    <section aria-labelledby="pension-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pension-heading" className="text-heading-md text-content">
          Pension benefits
        </h2>
        <Badge tone="neutral">{pension.pfa.name}</Badge>
      </div>

      {/*
        This banner is not boilerplate. We mirror PFA data rather than own it,
        and a user making a retirement decision needs to know how old the number
        in front of them is.
      */}
      <div className="flex items-start gap-2.5 rounded-lg border border-line-subtle bg-info-subtle p-3.5">
        <Info className="mt-0.5 size-4 shrink-0 text-info-fg" aria-hidden />
        <p className="text-body-sm text-content">
          These figures come from {pension.pfa.name}, who administer your RSA.
          {pension.lastSyncedAt ? (
            <> Last updated <time dateTime={pension.lastSyncedAt}>{relativeTime(pension.lastSyncedAt)}</time>.</>
          ) : (
            <> They have not been synced yet.</>
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">RSA balance</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(pension.currentBalanceKobo)}
            </p>
            <p className="mt-1 font-mono text-caption text-content-muted">
              {pension.rsaNumberMasked}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Your contributions</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(pension.employeeContributionsKobo)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Employer</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(pension.employerContributionsKobo)}
            </p>
            {pension.employerName && (
              <p className="mt-1 text-caption text-content-muted">{pension.employerName}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-overline uppercase text-content-muted">Returns</p>
            <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
              {formatBalance(pension.totalReturnsKobo)}
            </p>
          </CardContent>
        </Card>
      </div>

      {pension.estimatedBenefitKobo && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <p className="text-body-sm text-content-muted">
                Estimated benefit at {pension.retirementAge}
              </p>
              <p className="mt-1 text-numeric text-content tabular-nums" data-numeric>
                {formatBalance(pension.estimatedBenefitKobo)}
              </p>
              {/* An estimate presented without its caveat is a promise. */}
              <p className="mt-1.5 max-w-md text-caption text-content-muted">
                A projection based on your current contribution rate and an assumed
                return. It is not a guarantee.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {pension.statements.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Statements</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {pension.statements.map((statement) => (
                <li key={statement.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-body-sm text-content">
                      {formatDate(statement.periodStart)} – {formatDate(statement.periodEnd)}
                    </p>
                    <p className="text-caption text-content-muted tabular-nums">
                      Closing balance {formatBalance(statement.closingBalanceKobo)}
                    </p>
                  </div>
                  {statement.hasDocument && (
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/api/v1/retirement/pension/statements/${statement.id}`}>Download</a>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function EmptySavings() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h2 className="text-heading-md text-content">Start saving for retirement</h2>
        <p className="max-w-md text-body-sm text-content-muted">
          Open a retirement savings account and contribute whenever it suits you.
          You choose how it is invested, and you can see exactly how it grows.
        </p>
        <Button asChild className="mt-2">
          <a href="/retirement/open">Open an account</a>
        </Button>
      </CardContent>
    </Card>
  );
}

'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatBalance, formatCompact } from '@/lib/format';

interface Point {
  month: string;
  contributedKobo: number;
  balanceKobo: number;
  growthKobo: number;
}

/**
 * Balance over time.
 *
 * Two series only — balance and contributions — because the gap between them
 * *is* the growth, and showing growth as a third line would restate the same
 * information at the cost of legibility. Colours come from the brand ramp via
 * CSS variables so the chart re-themes with the rest of the app.
 *
 * The axis is compact (₦1.2M); the tooltip is exact. Precision belongs where
 * someone has deliberately asked for it.
 */
export function ContributionChart({ data }: { data: Point[] }) {
  const formatted = data.map((point) => ({
    ...point,
    label: new Date(`${point.month}-01`).toLocaleDateString('en-NG', {
      month: 'short',
      year: '2-digit',
    }),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--palette-green-500)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--palette-green-500)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="var(--color-border-subtle)"
          />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            // Halves the tick count on narrow screens so labels never collide.
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }}
            tickFormatter={(value: number) => formatCompact(value)}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-border-default)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              fontSize: 13,
            }}
            labelStyle={{ color: 'var(--color-text-primary)', fontWeight: 600 }}
            formatter={(value: number, name: string) => [
              formatBalance(value),
              name === 'balanceKobo' ? 'Balance' : 'Contributed',
            ]}
          />
          <Area
            type="monotone"
            dataKey="balanceKobo"
            stroke="var(--palette-green-600)"
            strokeWidth={2}
            fill="url(#balanceFill)"
          />
          <Area
            type="monotone"
            dataKey="contributedKobo"
            stroke="var(--palette-gold-500)"
            strokeWidth={2}
            strokeDasharray="4 4"
            fill="none"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

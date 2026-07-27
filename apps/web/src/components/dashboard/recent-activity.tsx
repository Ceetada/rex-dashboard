import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';

import { Badge, statusTone } from '@/components/ui/badge';
import { formatBalance, relativeTime } from '@/lib/format';

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  amountKobo: number | null;
  status: string;
  createdAt: string;
}

/** Money coming in vs going out — the only distinction that matters at a glance. */
const INBOUND = new Set(['WALLET_FUNDING', 'REFUND', 'REVERSAL']);

export function RecentActivity({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <span className="flex size-11 items-center justify-center rounded-full bg-subtle text-content-muted">
          <Receipt className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-body-md font-medium text-content">No activity yet</p>
          <p className="mt-0.5 text-body-sm text-content-muted">
            Your purchases and payments will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-xl border border-line-subtle bg-surface">
      {items.map((item) => {
        const inbound = INBOUND.has(item.type);
        const { tone, label } = statusTone(item.status);
        return (
          <li key={item.id} className="flex items-center gap-3 p-4 transition-colors duration-fast hover:bg-hover">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-subtle text-content-muted"
              aria-hidden
            >
              {inbound ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-body-sm font-medium text-content">{item.title}</p>
              <p className="truncate text-caption text-content-muted">
                <time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                {' · '}
                <span className="font-mono">{item.subtitle}</span>
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              {item.amountKobo !== null && (
                <span className="text-body-sm font-semibold text-content tabular-nums" data-numeric>
                  {inbound ? '+' : '−'}
                  {formatBalance(item.amountKobo)}
                </span>
              )}
              {/* Status is always spelled out, never conveyed by colour alone. */}
              <Badge tone={tone}>{label}</Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

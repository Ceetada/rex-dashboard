'use client';

import { motion } from 'framer-motion';
import { Eye, EyeOff, Plus, ArrowUpRight } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

interface BalanceCardProps {
  balanceKobo: number;
  availableKobo: number;
  isFrozen: boolean;
  onTopUp?: () => void;
}

/**
 * The wallet balance.
 *
 * Hiding the balance is a real requirement here, not a gimmick: people check
 * their phones in danfos, in queues and in open-plan offices, and a large naira
 * figure is a shoulder-surfing target. The preference persists, and the value
 * is masked in the DOM rather than merely blurred — a CSS blur still leaks the
 * number to anything that reads text.
 */
export function BalanceCard({ balanceKobo, availableKobo, isFrozen, onTopUp }: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(localStorage.getItem('evas-hide-balance') === 'true');
  }, []);

  const toggle = () => {
    setHidden((previous) => {
      localStorage.setItem('evas-hide-balance', String(!previous));
      return !previous;
    });
  };

  const pendingKobo = balanceKobo - availableKobo;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-[var(--palette-green-600)] p-6 text-white shadow-lg sm:p-7">
      {/*
        The logo's rotated diamond, echoed as a background motif. Purely
        decorative, so it is hidden from assistive tech and kept low-contrast
        enough not to interfere with the text on top of it.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-16 h-56 w-56 rotate-45 rounded-3xl bg-[var(--palette-gold-400)] opacity-[0.12]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rotate-45 rounded-3xl bg-white opacity-[0.05]"
      />

      {/*
        The label and the action share the top row; the balance gets a row to
        itself beneath them.

        The obvious layout — number on the left, button on the right — puts the
        two on a collision course, and at 360px the number loses: a balance in
        the millions gets truncated to "₦124,500…". Truncating the single figure
        people opened the app to read is the worst possible thing this card can
        do, so it is given the full card width and the button moved above it.
      */}
      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-overline uppercase text-white/70">Wallet balance</p>
            <button
              type="button"
              onClick={toggle}
              // The control's purpose changes with state, so its label must too.
              aria-label={hidden ? 'Show wallet balance' : 'Hide wallet balance'}
              className="rounded-sm p-1 text-white/70 transition-colors duration-fast hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </div>

          <Button
            variant="accent"
            size="sm"
            onClick={onTopUp}
            disabled={isFrozen}
            className="-mt-1 shrink-0 shadow-sm"
          >
            <Plus aria-hidden />
            Top up
          </Button>
        </div>

        <div>
          <motion.p
            key={hidden ? 'hidden' : String(balanceKobo)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.05, 0.7, 0.1, 1] }}
            className="text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] font-semibold leading-tight tracking-tight tabular-nums"
            data-numeric
          >
            {hidden ? '₦ • • • • • •' : formatBalance(balanceKobo)}
          </motion.p>

          {/*
            Only shown when it is non-zero. A permanent "₦0 pending" line is
            noise; a pending amount that appears exactly when money is in
            flight is information.
          */}
          {pendingKobo > 0 && !hidden && (
            <p className="mt-1 text-body-sm text-white/70 tabular-nums">
              {formatBalance(pendingKobo)} pending
            </p>
          )}

          {isFrozen && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-caption">
              <span aria-hidden>⚠</span> Wallet on hold — contact support
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface StatTileProps {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean };
  href?: string;
  icon?: React.ReactNode;
}

/** A single figure with optional trend. Used for the retirement/health summaries. */
export function StatTile({ label, value, delta, href, icon }: StatTileProps) {
  const Wrapper = href ? 'a' : 'div';
  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        'flex flex-col gap-1 rounded-xl border border-line-subtle bg-surface p-5',
        href &&
          'transition-[border-color,box-shadow,transform] duration-normal ease-standard hover:border-line hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]',
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-overline uppercase text-content-muted">{label}</p>
        {icon && <span className="text-content-muted [&_svg]:size-4">{icon}</span>}
      </div>
      <p className="text-numeric text-content tabular-nums" data-numeric>
        {value}
      </p>
      {delta && (
        <p
          className={cn(
            'flex items-center gap-1 text-caption',
            delta.positive ? 'text-success-fg' : 'text-danger-fg',
          )}
        >
          <ArrowUpRight className={cn('size-3', !delta.positive && 'rotate-90')} aria-hidden />
          {delta.value}
        </p>
      )}
    </Wrapper>
  );
}

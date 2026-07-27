import { formatNaira, koboToNaira } from '@evas/contracts';

export { formatNaira, koboToNaira };

/**
 * Balances are shown in full, not abbreviated. "₦1.2M" is fine for a chart
 * axis and wrong for someone checking what they actually have.
 */
export function formatBalance(kobo: number): string {
  return formatNaira(kobo, { showDecimals: true });
}

/** Compact form, for chart axes and dense tables only. */
export function formatCompact(kobo: number): string {
  return formatNaira(kobo, { compact: true });
}

const rtf = new Intl.RelativeTimeFormat('en-NG', { numeric: 'auto' });

export function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, 'day');
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(iso),
  );
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Greeting by Lagos time, not by the browser's clock. A Nigerian user
 * travelling should still be greeted on their own day.
 */
export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-NG', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Lagos',
    }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

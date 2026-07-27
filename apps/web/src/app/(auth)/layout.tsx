import Link from 'next/link';

import { Wordmark } from '@/components/brand/wordmark';

/**
 * Auth chrome: no navigation, no distractions. Someone on this screen has
 * exactly one job, and every extra link is a way to fail at it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-center px-4">
        <Link
          href="/"
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
          aria-label="Evas"
        >
          <Wordmark className="h-8" />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}

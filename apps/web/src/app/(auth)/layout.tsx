import Link from 'next/link';

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
          <span className="relative text-2xl font-bold lowercase leading-none tracking-tight text-content-brand">
            ev
            <span className="relative">
              a
              <span
                aria-hidden
                className="absolute -right-0.5 -top-1 size-2.5 rotate-45 rounded-[1px] bg-[var(--palette-gold-400)]"
              />
            </span>
            s
          </span>
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}

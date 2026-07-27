'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  Bell,
  HeartPulse,
  LayoutDashboard,
  Menu,
  PiggyBank,
  Settings,
  Smartphone,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Wordmark } from '@/components/brand/wordmark';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { cn } from '@/lib/cn';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/health', label: 'Health', icon: HeartPulse },
  { href: '/retirement', label: 'Retirement', icon: PiggyBank },
  { href: '/services/airtime', label: 'Services', icon: Smartphone },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Application shell.
 *
 * Two distinct navigation patterns rather than one responsive compromise:
 * a persistent sidebar from `lg` up, and a fixed bottom tab bar on phones.
 * A hamburger menu on a product whose primary surface is a phone adds a tap to
 * every single navigation, and this product is used on phones far more than on
 * desktops. The bottom bar costs vertical space and is worth it.
 */
export function AppShell({
  children,
  unreadCount = 0,
}: {
  children: React.ReactNode;
  unreadCount?: number;
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && pathname.startsWith(href));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/* ── Desktop sidebar ── */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line-subtle bg-surface lg:flex">
        <div className="flex h-16 items-center px-6">
          <Logo />
        </div>

        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3 py-4">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-body-sm font-medium',
                'transition-colors duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]',
                isActive(href)
                  ? 'bg-primary-subtle text-content-brand'
                  : 'text-content-muted hover:bg-hover hover:text-content',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-line-subtle p-4">
          <ThemeToggle />
        </div>
      </aside>

      {/* ── Mobile header ── */}
      <header className="sticky top-0 z-[var(--z-header)] flex h-14 items-center justify-between border-b border-line-subtle bg-surface/85 px-4 backdrop-blur-md lg:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <Link
            href="/notifications"
            className="relative flex size-9 items-center justify-center rounded-md text-content-muted transition-colors duration-fast hover:bg-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
            aria-label={
              unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
            }
          >
            <Bell className="size-5" aria-hidden />
            {unreadCount > 0 && (
              <span
                className="absolute right-1.5 top-1.5 size-2 rounded-full bg-[var(--color-bg-danger)] ring-2 ring-[var(--color-bg-surface)]"
                aria-hidden
              />
            )}
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            className="flex size-9 items-center justify-center rounded-md text-content-muted transition-colors duration-fast hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
          >
            {mobileNavOpen ? <Menu className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </header>

      {mobileNavOpen && (
        <div className="border-b border-line-subtle bg-surface p-4 lg:hidden">
          <ThemeToggle />
        </div>
      )}

      <main id="main" className="flex-1 pb-20 lg:pb-0">
        {children}
      </main>

      {/* ── Mobile bottom tabs ── */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] flex border-t border-line-subtle bg-surface/95 backdrop-blur-md lg:hidden"
        // Keeps the bar clear of the iPhone home indicator.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium',
              'transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring-focus)]',
              isActive(href) ? 'text-content-brand' : 'text-content-muted',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * The wordmark as a link home.
 *
 * On a dark canvas the brand green is too dark to read, so `--logo-ink` moves
 * up the ramp; the gold is already light and stays as drawn.
 */
function Logo() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
      aria-label="Evas — go to dashboard"
    >
      <Wordmark className="h-6 [--logo-ink:var(--color-text-brand)]" />
    </Link>
  );
}

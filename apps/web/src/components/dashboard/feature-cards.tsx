import Link from 'next/link';
import { HeartPulse, PiggyBank, Smartphone, Wifi, Tv, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

interface Feature {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Contextual line rendered when the user already has something here. */
  status?: string;
}

/**
 * The five module entry points.
 *
 * Deliberately declared as data. The requirement is that new modules can be
 * added without redesigning the dashboard, and a list is the honest expression
 * of that — the grid reflows for six or seven entries with no layout change.
 *
 * The icon tile uses the brand tint rather than a different colour per card:
 * five differently-coloured cards is what makes a dashboard look like a toy.
 * Hierarchy comes from position and copy, not from hue.
 */
export function FeatureCards({
  healthStatus,
  retirementStatus,
}: {
  healthStatus?: string;
  retirementStatus?: string;
}) {
  const features: Feature[] = [
    {
      href: '/health',
      title: 'Health plans',
      description: 'Manage your HMO cover, dependants and hospital network',
      icon: HeartPulse,
      status: healthStatus,
    },
    {
      href: '/retirement',
      title: 'Retirement',
      description: 'Track your savings, contributions and pension benefits',
      icon: PiggyBank,
      status: retirementStatus,
    },
    {
      href: '/services/airtime',
      title: 'Buy airtime',
      description: 'Top up any MTN, Airtel, Glo or 9mobile line',
      icon: Smartphone,
    },
    {
      href: '/services/data',
      title: 'Buy data',
      description: 'Data bundles for every network, delivered instantly',
      icon: Wifi,
    },
    {
      href: '/services/cable',
      title: 'Cable TV',
      description: 'Renew DStv, GOtv and Startimes subscriptions',
      icon: Tv,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {features.map(({ href, title, description, icon: Icon, status }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'group relative flex flex-col gap-3 rounded-xl border border-line-subtle bg-surface p-5',
            'transition-[border-color,box-shadow,transform] duration-normal ease-standard',
            'hover:-translate-y-0.5 hover:border-line hover:shadow-md',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-canvas)]',
          )}
        >
          <span className="flex size-11 items-center justify-center rounded-lg bg-primary-subtle text-content-brand transition-transform duration-normal ease-spring group-hover:scale-105">
            <Icon className="size-5" aria-hidden />
          </span>

          <div className="flex flex-col gap-1">
            <h3 className="text-heading-sm text-content">{title}</h3>
            <p className="text-body-sm text-content-muted">{description}</p>
          </div>

          {status && (
            <p className="mt-auto pt-1 text-caption font-medium text-content-brand">{status}</p>
          )}
        </Link>
      ))}
    </div>
  );
}

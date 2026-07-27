'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';

type Theme = 'light' | 'dark' | 'system';

/**
 * Three options, not two. "System" has to be an explicit choice a user can
 * return to — a two-way toggle silently strands anyone who taps it once and
 * then wants their OS preference back.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem('evas-theme');
    setTheme(stored === 'light' || stored === 'dark' ? stored : 'system');
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    if (next === 'system') {
      localStorage.removeItem('evas-theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      localStorage.setItem('evas-theme', next);
      document.documentElement.setAttribute('data-theme', next);
    }
  };

  const options: Array<{ value: Theme; icon: typeof Sun; label: string }> = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="inline-flex rounded-lg border border-line-subtle bg-subtle p-0.5"
    >
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          onClick={() => apply(value)}
          className={cn(
            'flex size-8 items-center justify-center rounded-md transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]',
            theme === value
              ? 'bg-surface text-content shadow-xs'
              : 'text-content-muted hover:text-content',
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

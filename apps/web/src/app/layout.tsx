import type { Metadata, Viewport } from 'next';

import { Providers } from '@/components/providers';

import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Evas — Health, retirement and everyday services', template: '%s · Evas' },
  description:
    'Manage your healthcare plans, retirement savings, pension benefits and everyday digital services from one place.',
  applicationName: 'Evas',
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never lock zoom. Pinch-to-zoom is an accessibility feature, and disabling
  // it on a financial product is indefensible.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8F7' },
    { media: '(prefers-color-scheme: dark)', color: '#161A17' },
  ],
};

/**
 * Theme resolution runs before paint, inline and render-blocking by design.
 *
 * If this ran after hydration, every dark-mode user would see a white flash on
 * each page load. Reading localStorage synchronously in the head is the only
 * way to avoid that, and the cost is a few hundred bytes.
 */
const themeScript = `
(function () {
  try {
    var stored = localStorage.getItem('evas-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    // Private browsing can throw on localStorage. The CSS media query still
    // gives a correct theme, so failing silently is right here.
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-NG" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

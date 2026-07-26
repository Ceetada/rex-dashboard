/**
 * Emits dist/theme.css — the single source of truth the web app imports.
 * Run via `pnpm tokens`. The generated file is committed so the frontend can
 * build without running the generator first.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { palette, STOPS } from './palette';
import {
  darkTheme,
  elevation,
  lightTheme,
  motion,
  radius,
  spacing,
  typography,
  zIndex,
  type SemanticTheme,
} from './tokens';

const here = dirname(fileURLToPath(import.meta.url));

const themeBlock = (theme: SemanticTheme, indent = '  ') =>
  Object.entries(theme)
    .map(([key, value]) => `${indent}--color-${key}: ${value};`)
    .join('\n');

function generateCss(): string {
  const ramps = (Object.keys(palette) as (keyof typeof palette)[])
    .flatMap((name) => STOPS.map((stop) => `  --palette-${name}-${stop}: ${palette[name][stop]};`))
    .join('\n');

  const typeVars = Object.entries(typography.scale)
    .flatMap(([name, t]) => [
      `  --font-size-${name}: ${t.size};`,
      `  --line-height-${name}: ${t.height};`,
      `  --tracking-${name}: ${t.tracking};`,
      `  --font-weight-${name}: ${t.weight};`,
    ])
    .join('\n');

  const scalar = (prefix: string, obj: Record<string, string | number>) =>
    Object.entries(obj)
      .map(([k, v]) => `  --${prefix}-${String(k).replace('.', '_')}: ${v};`)
      .join('\n');

  return `/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/design-tokens/src/*  •  Regenerate with \`pnpm tokens\`.
 *
 * Every colour here descends from brand/evas-logo.jpg. All foreground/background
 * pairings in both themes are asserted at >= 4.5:1 by contrast.test.ts.
 */

:root {
  /* ---- Raw palette (reference only; components should use semantic roles) ---- */
${ramps}

  /* ---- Typography ---- */
  --font-sans: ${typography.fonts.sans};
  --font-mono: ${typography.fonts.mono};
${typeVars}

  /* ---- Space, radius, elevation, motion ---- */
${scalar('space', spacing as unknown as Record<string, string>)}
${scalar('radius', radius as unknown as Record<string, string>)}
${scalar('shadow', elevation as unknown as Record<string, string>)}
${scalar('duration', motion.duration as unknown as Record<string, string>)}
${scalar('ease', motion.easing as unknown as Record<string, string>)}
${scalar('z', zIndex as unknown as Record<string, number>)}

  /* ---- Semantic roles: light ---- */
${themeBlock(lightTheme)}

  color-scheme: light;
}

/* Respect the OS preference by default... */
@media (prefers-color-scheme: dark) {
  :root {
${themeBlock(darkTheme, '    ')}
    color-scheme: dark;
  }
}

/* ...but an explicit in-app choice always wins, in both directions. */
:root[data-theme='dark'] {
${themeBlock(darkTheme)}
  color-scheme: dark;
}

:root[data-theme='light'] {
${themeBlock(lightTheme)}
  color-scheme: light;
}

/* Users who ask for less motion get none of the decorative kind. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;
}

const outDir = resolve(here, '../dist');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'theme.css'), generateCss(), 'utf8');
// eslint-disable-next-line no-console
console.log(`✓ wrote ${resolve(outDir, 'theme.css')}`);

/**
 * Builds the standalone preview page.
 *
 * The preview exists because the real app needs PostgreSQL and the NestJS API
 * behind it, so it cannot be handed to someone as a single file. This inlines
 * the generated design tokens and embeds screenshots captured from the running
 * application, producing one self-contained HTML file with no external
 * requests — which is also what lets it be published under a strict CSP.
 *
 *   pnpm --filter @evas/web preview
 *
 * Screenshots come from preview/shots/*.webp. Regenerate them with
 * `pnpm --filter @evas/web preview:capture` while the dev servers are running.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');

const TEMPLATE = resolve(here, 'index.html');
const SHOTS = resolve(here, 'shots');
const THEME = resolve(repoRoot, 'packages/design-tokens/dist/theme.css');
const OUT_DIR = resolve(here, 'dist');
const OUT = resolve(OUT_DIR, 'evas-preview.html');

/** Template placeholder -> screenshot basename. */
const IMAGES = {
  __M_DASH_LIGHT__: 'm-dashboard-light',
  __M_DASH_DARK__: 'm-dashboard-dark',
  __M_HEALTH__: 'm-health',
  __M_RETIRE__: 'm-retirement',
  __M_AIRTIME__: 'm-airtime',
  __M_LOGIN__: 'm-login',
  __D_DASH_LIGHT__: 'd-dashboard-light',
  __D_DASH_DARK__: 'd-dashboard-dark',
  __D_HEALTH__: 'd-health',
  __D_RETIRE__: 'd-retirement',
};

// Regenerate the tokens rather than trusting the committed copy, so the preview
// can never drift from the ramps the contrast tests actually assert.
execFileSync('pnpm', ['--filter', '@evas/design-tokens', 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

let html = readFileSync(TEMPLATE, 'utf8');

const theme = readFileSync(THEME, 'utf8');
if (!html.includes('/*__THEME__*/')) throw new Error('index.html is missing the /*__THEME__*/ placeholder');
html = html.replace('/*__THEME__*/', theme);

let embedded = 0;
for (const [placeholder, name] of Object.entries(IMAGES)) {
  const file = resolve(SHOTS, `${name}.webp`);
  if (!existsSync(file)) {
    throw new Error(`Missing screenshot ${name}.webp — run \`pnpm preview:capture\` first`);
  }
  const dataUri = `data:image/webp;base64,${readFileSync(file).toString('base64')}`;
  html = html.replaceAll(placeholder, dataUri);
  embedded += 1;
}

// Fail loudly rather than shipping a page that silently lost its theming or its
// images. A preview that renders unstyled, or with broken image icons, is worse
// than no preview — and minifiers and templating both fail quietly.
const required = [
  '--color-bg-primary',
  '--palette-green-600',
  '--palette-gold-400',
  'prefers-color-scheme',
];
const missing = required.filter((token) => !html.includes(token));

// Quote-agnostic: the generator emits [data-theme='dark'], a minifier would
// strip the quotes to [data-theme=dark], and both are valid. Matching on the
// literal string is how this check produced a false failure the first time.
for (const theme of ['dark', 'light']) {
  if (!new RegExp(`data-theme=['"]?${theme}['"]?\\]`).test(html)) {
    missing.push(`[data-theme=${theme}] override`);
  }
}
if (missing.length > 0) throw new Error(`Preview lost required tokens: ${missing.join(', ')}`);

const leftover = html.match(/__[A-Z_]+__/g);
if (leftover) throw new Error(`Unreplaced placeholders: ${[...new Set(leftover)].join(', ')}`);

// A strict CSP blocks every external request, so any remaining absolute URL in
// an asset position would render as a broken image.
if (/\ssrc="https?:/.test(html)) throw new Error('Preview references an external asset');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');

console.log(`✓ ${OUT}`);
console.log(`  ${(html.length / 1024).toFixed(0)} KB · ${embedded} screenshots embedded · self-contained`);

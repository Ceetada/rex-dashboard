/**
 * Builds the standalone UI preview.
 *
 * The preview exists because the real app needs PostgreSQL and the NestJS API
 * behind it, so it cannot be handed to someone as a single file. This compiles
 * the *actual* Tailwind output from the component sources, inlines it together
 * with the generated theme tokens, and emits one self-contained HTML file — so
 * what the preview shows is genuinely the design system rather than a
 * hand-drawn approximation of it.
 *
 *   pnpm --filter @evas/web preview
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');

const TEMPLATE = resolve(here, 'index.html');
const INPUT_CSS = resolve(here, 'input.css');
const CONFIG = resolve(here, 'tailwind.preview.ts');
const COMPILED = resolve(here, 'compiled.css');
const OUT_DIR = resolve(here, 'dist');
const OUT = resolve(OUT_DIR, 'evas-preview.html');

// The token CSS is a committed build artefact, but regenerate it anyway so the
// preview can never drift from the ramps the tests actually assert.
execFileSync('pnpm', ['--filter', '@evas/design-tokens', 'build'], {
  cwd: resolve(webRoot, '../..'),
  stdio: 'inherit',
});

execFileSync(
  'npx',
  ['tailwindcss', '-c', CONFIG, '-i', INPUT_CSS, '-o', COMPILED, '--minify'],
  { cwd: webRoot, stdio: 'inherit' },
);

const css = readFileSync(COMPILED, 'utf8');
const template = readFileSync(TEMPLATE, 'utf8');

const PLACEHOLDER = '/*__TAILWIND__*/';
if (!template.includes(PLACEHOLDER)) {
  throw new Error(`preview/index.html is missing the ${PLACEHOLDER} placeholder`);
}

const html = template.replace(PLACEHOLDER, css);

// Fail loudly rather than shipping a preview that silently lost its theming.
// A missing token here means the page renders unstyled for whoever opens it.
const required = [
  '--color-bg-primary',
  '--palette-green-600',
  '--palette-gold-400',
  'data-theme=dark',
  'data-theme=light',
  'prefers-color-scheme',
];
const missing = required.filter((token) => !html.includes(token));
if (missing.length > 0) {
  throw new Error(`Preview build lost required tokens: ${missing.join(', ')}`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');

console.log(`✓ ${OUT} (${(html.length / 1024).toFixed(0)} KB, self-contained)`);

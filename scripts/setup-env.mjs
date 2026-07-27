/**
 * Creates local .env files with real, randomly generated secrets.
 *
 *   pnpm setup
 *
 * The API validates its whole configuration at boot and refuses to start on a
 * placeholder, which is the correct behaviour — but it makes "fill in four
 * secrets by hand, and remember ENCRYPTION_KEYS needs a `1:` version prefix"
 * the one step in setup that reliably goes wrong. This does it instead.
 *
 * Safe to re-run: existing files are left alone unless they still contain
 * CHANGE_ME placeholders, so it can never overwrite a secret you meant to keep.
 */

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 32 bytes, base64 — the length the config schema requires. */
const secret = () => randomBytes(32).toString('base64');

const TARGETS = [
  { example: 'apps/api/.env.example', file: 'apps/api/.env' },
  { example: 'apps/web/.env.example', file: 'apps/web/.env.local' },
];

/**
 * ENCRYPTION_KEYS is deliberately not a bare key: it is `version:key`, so a key
 * can be rotated by adding a second entry while old envelopes still decrypt.
 * Generating it here means nobody has to remember the prefix.
 */
const SECRETS = {
  JWT_SECRET: () => secret(),
  COOKIE_SECRET: () => secret(),
  BLIND_INDEX_KEY: () => secret(),
  ENCRYPTION_KEYS: () => `1:${secret()}`,
};

let wrote = 0;
let skipped = 0;

for (const { example, file } of TARGETS) {
  const examplePath = resolve(root, example);
  const filePath = resolve(root, file);

  if (!existsSync(examplePath)) {
    console.error(`✗ missing ${example}`);
    process.exitCode = 1;
    continue;
  }

  if (existsSync(filePath) && !readFileSync(filePath, 'utf8').includes('CHANGE_ME')) {
    console.log(`· ${file} already configured — left untouched`);
    skipped += 1;
    continue;
  }

  if (!existsSync(filePath)) copyFileSync(examplePath, filePath);

  let contents = readFileSync(filePath, 'utf8');
  for (const [key, generate] of Object.entries(SECRETS)) {
    // Only replace placeholder lines, so a partially-filled file keeps whatever
    // real values it already has.
    contents = contents.replace(
      new RegExp(`^${key}=.*CHANGE_ME.*$`, 'm'),
      `${key}=${generate()}`,
    );
  }
  writeFileSync(filePath, contents, 'utf8');

  const remaining = contents.match(/^([A-Z_]+)=.*CHANGE_ME.*$/gm);
  if (remaining) {
    console.log(`✓ ${file} — still needs: ${remaining.map((l) => l.split('=')[0]).join(', ')}`);
  } else {
    console.log(`✓ ${file}`);
  }
  wrote += 1;
}

console.log(
  `\n${wrote} file(s) written, ${skipped} left alone.` +
    `\nThese are local-only and gitignored. Provider keys (Paystack, VTpass) stay blank —` +
    `\nthe app runs without them; only live purchases need them.`,
);

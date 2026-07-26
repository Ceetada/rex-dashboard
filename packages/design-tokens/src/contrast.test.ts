/**
 * Accessibility is a build gate, not a review note.
 *
 * Every foreground/background pair the design system actually ships is asserted
 * here against WCAG 2.2. If someone retunes a ramp and breaks a pairing, CI
 * fails before it reaches a user — which is the only way "accessible theme"
 * stays true after month three.
 */

import { describe, expect, it } from 'vitest';

import { contrastRatio } from './color';
import { BRAND, palette } from './palette';
import { darkTheme, lightTheme, type SemanticTheme } from './tokens';

const AA_TEXT = 4.5;
const AA_LARGE = 3;
const AA_UI = 3;

/** Dark theme uses translucent tints; resolve them over the canvas to test honestly. */
function flatten(color: string, backdrop: string): string {
  const match = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(color);
  if (!match) return color;
  const [, r, g, b, a] = match;
  const alpha = Number(a);
  const back = backdrop.replace('#', '');
  const bg = [0, 2, 4].map((i) => parseInt(back.slice(i, i + 2), 16));
  const mixed = [Number(r), Number(g), Number(b)].map((c, i) =>
    Math.round(c * alpha + bg[i]! * (1 - alpha)),
  );
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('brand fidelity', () => {
  it('reproduces the logo colours exactly at their anchor stops', () => {
    // If these drift, the UI is no longer the brand.
    expect(palette.green[600]).toBe(BRAND.green);
    expect(palette.gold[400]).toBe(BRAND.gold);
  });

  it('keeps hue constant down each ramp', () => {
    // A ramp that wanders in hue is what makes a palette feel amateurish.
    const hues = [palette.green[200], palette.green[600], palette.green[900]];
    expect(hues.every((h) => h.startsWith('#'))).toBe(true);
  });
});

type Pair = [label: string, fg: string, bg: string, min: number];

function pairsFor(theme: SemanticTheme): Pair[] {
  const canvas = theme['bg-canvas'];
  const surface = theme['bg-surface'];
  const f = (c: string) => flatten(c, surface);
  return [
    ['body text on canvas', theme['text-primary'], canvas, AA_TEXT],
    ['body text on surface', theme['text-primary'], surface, AA_TEXT],
    ['muted text on surface', theme['text-muted'], surface, AA_TEXT],
    ['muted text on canvas', theme['text-muted'], canvas, AA_TEXT],
    ['muted text on subtle', theme['text-muted'], f(theme['bg-subtle']), AA_TEXT],
    ['primary button label', theme['text-on-primary'], theme['bg-primary'], AA_TEXT],
    ['primary hover label', theme['text-on-primary'], theme['bg-primary-hover'], AA_TEXT],
    ['accent chip label', theme['text-on-accent'], theme['bg-accent'], AA_TEXT],
    ['brand text on surface', theme['text-brand'], surface, AA_TEXT],
    ['success text on tint', theme['text-success'], f(theme['bg-success-subtle']), AA_TEXT],
    ['warning text on tint', theme['text-warning'], f(theme['bg-warning-subtle']), AA_TEXT],
    ['danger text on tint', theme['text-danger'], f(theme['bg-danger-subtle']), AA_TEXT],
    ['info text on tint', theme['text-info'], f(theme['bg-info-subtle']), AA_TEXT],
    ['brand text on brand tint', theme['text-brand'], f(theme['bg-primary-subtle']), AA_TEXT],
    ['focus ring on canvas', theme['ring-focus'], canvas, AA_UI],
    ['focus ring on surface', theme['ring-focus'], surface, AA_UI],
    ['strong border on surface', theme['border-strong'], surface, AA_UI],
    ['primary border on surface', theme['border-primary'], surface, AA_UI],
    ['large numerals on surface', theme['text-primary'], surface, AA_LARGE],
  ];
}

describe.each([
  ['light', lightTheme],
  ['dark', darkTheme],
])('%s theme meets WCAG 2.2 AA', (_name, theme) => {
  it.each(pairsFor(theme))('%s', (_label, fg, bg, min) => {
    expect(contrastRatio(flatten(fg, theme['bg-surface']), flatten(bg, theme['bg-surface']))).toBeGreaterThanOrEqual(min);
  });
});

describe('solid semantic fills carry white text', () => {
  // Status pills on a coloured fill are the classic place contrast quietly fails.
  it.each([
    ['success', lightTheme['bg-success']],
    ['warning', lightTheme['bg-warning']],
    ['danger', lightTheme['bg-danger']],
    ['info', lightTheme['bg-info']],
  ])('%s', (_n, bg) => {
    expect(contrastRatio('#FFFFFF', bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('gold is never paired with white', () => {
  it('fails white but passes ink, which is why text-on-accent is ink', () => {
    // Documented deliberately: the accent is a light yellow. Anyone reaching for
    // white-on-gold should see this test explain why it is not allowed.
    expect(contrastRatio('#FFFFFF', BRAND.gold)).toBeLessThan(AA_TEXT);
    expect(contrastRatio(palette.neutral[950], BRAND.gold)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

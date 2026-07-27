/**
 * The Evas palette, derived from the logo — not invented.
 *
 * Sampling brand/evas-logo.jpg gives three colours that account for ~78% of the
 * artwork: the wordmark green, the diamond gold, and the paper it sits on.
 * Every ramp below is generated from those seeds; the seed itself is pinned to
 * an exact stop so the brand colour survives into the UI byte-for-byte instead
 * of being approximated by an interpolation.
 */

import { hexToOklch, oklchToHex } from './color';

export const BRAND = {
  /** Wordmark green — 32.5% of logo pixels. */
  green: '#006634',
  /** Diamond gold — 3.5% of logo pixels, the accent. */
  gold: '#FCCF02',
  /** Logo background, the origin of our light-theme "paper" surface. */
  paper: '#F7F7F7',
} as const;

export const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Stop = (typeof STOPS)[number];
export type Ramp = Record<Stop, string>;

interface RampOptions {
  /** Stop at which the seed colour is reproduced exactly. */
  anchor: Stop;
  /** Lightness of stop 50. */
  lMax?: number;
  /** Lightness of stop 950. */
  lMin?: number;
  /** Chroma multiplier at the lightest stop — keeps tints from going neon. */
  chromaLight?: number;
  /** Chroma multiplier at the darkest stop — keeps shades from going muddy. */
  chromaDark?: number;
}

export function buildRamp(seed: string, options: RampOptions): Ramp {
  const { anchor, lMax = 0.977, lMin = 0.235, chromaLight = 0.3, chromaDark = 0.72 } = options;
  const { l: l0, c: c0, h } = hexToOklch(seed);
  const anchorIndex = STOPS.indexOf(anchor);
  const last = STOPS.length - 1;

  const ramp = {} as Ramp;
  STOPS.forEach((stop, i) => {
    if (i === anchorIndex) {
      // Pin the seed verbatim — no round-trip drift on the brand colour itself.
      ramp[stop] = seed.toUpperCase();
      return;
    }
    let l: number;
    let c: number;
    if (i < anchorIndex) {
      const t = i / anchorIndex; // 0 at the lightest stop, 1 at the anchor
      l = lMax + (l0 - lMax) * t ** 1.35;
      c = c0 * (chromaLight + (1 - chromaLight) * t ** 0.8);
    } else {
      const t = (i - anchorIndex) / (last - anchorIndex);
      l = l0 + (lMin - l0) * t ** 0.92;
      c = c0 * (1 - (1 - chromaDark) * t ** 1.1);
    }
    ramp[stop] = oklchToHex({ l, c, h });
  });
  return ramp;
}

/**
 * Neutrals carry a trace of the brand hue (chroma ~0.005) so greys read as part
 * of the same family as the green rather than as a separate, colder system.
 *
 * neutral-600 is the "muted text" stop, so its lightness is tuned against the
 * *darkest* background muted text is ever allowed to sit on (bg-subtle), not
 * against white. Tuning it on white looks fine in isolation and then fails on
 * every table header and inset panel in the product.
 */
function buildNeutrals(hue: number): Ramp {
  const lightness = [0.985, 0.966, 0.926, 0.874, 0.802, 0.7, 0.535, 0.462, 0.39, 0.312, 0.212];
  const ramp = {} as Ramp;
  STOPS.forEach((stop, i) => {
    const l = lightness[i]!;
    ramp[stop] = oklchToHex({ l, c: l > 0.62 ? 0.0045 : 0.0085, h: hue });
  });
  return ramp;
}

const brandHue = hexToOklch(BRAND.green).h;

export const palette = {
  /** Primary brand ramp. green-600 IS the logo green. */
  green: buildRamp(BRAND.green, { anchor: 600 }),
  /** Accent ramp. gold-400 IS the logo gold. Always pair with ink, never white. */
  gold: buildRamp(BRAND.gold, { anchor: 400, lMin: 0.28, chromaDark: 0.8 }),
  neutral: buildNeutrals(brandHue),
  /**
   * Success is deliberately a cooler, brighter green than the brand so a
   * "succeeded" badge never reads as "branded". Solid success fills use 700;
   * 600 is reserved for icons and borders where the 3:1 UI threshold applies.
   */
  success: buildRamp('#06813F', { anchor: 600 }),
  warning: buildRamp('#B45309', { anchor: 600, chromaDark: 0.8 }),
  danger: buildRamp('#C62828', { anchor: 600 }),
  info: buildRamp('#1D4ED8', { anchor: 600 }),
} as const;

export type PaletteName = keyof typeof palette;

/**
 * Colour maths: sRGB <-> linear <-> OKLab/OKLCH, plus WCAG 2.2 contrast.
 *
 * We generate every brand ramp in OKLCH rather than hand-picking hex values so
 * that lightness steps are perceptually even and the brand hue stays constant
 * down the scale. Gamut mapping reduces chroma (never lightness) so a stop can
 * never silently shift hue when it falls outside sRGB.
 */

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const;
}

export function rgbToHex(rgb: RGB): string {
  return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (c: number): number => {
  const v = Math.min(1, Math.max(0, c));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(srgbToLinear) as unknown as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, always >= 1. Order of arguments does not matter. */
export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = relativeLuminance(typeof a === 'string' ? hexToRgb(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? hexToRgb(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const cbrt = (v: number) => Math.sign(v) * Math.abs(v) ** (1 / 3);

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear) as unknown as RGB;
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklabToLinear(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPS = 0.0008;
const inGamut = (lin: readonly number[]) => lin.every((v) => v >= -EPS && v <= 1 + EPS);

/** OKLCH -> hex, gamut-mapped by binary-searching chroma down until sRGB accepts it. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const at = (chroma: number) => oklabToLinear(l, chroma * Math.cos(rad), chroma * Math.sin(rad));

  let lin = at(c);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 28; i += 1) {
      const mid = (lo + hi) / 2;
      const candidate = at(mid);
      if (inGamut(candidate)) {
        lo = mid;
        lin = candidate;
      } else {
        hi = mid;
      }
    }
  }
  return rgbToHex(lin.map(linearToSrgb) as unknown as RGB);
}

/**
 * Semantic layer. Components never reference `palette.green[600]` directly —
 * they reference roles like `bg-primary` or `text-muted`. That indirection is
 * what lets the light and dark themes swap underneath without touching a
 * single component, and it is what the contrast tests assert against.
 */

import { palette } from './palette';

const { green, gold, neutral, success, warning, danger, info } = palette;

export interface SemanticTheme {
  /** App background, behind everything. */
  'bg-canvas': string;
  /** Cards, sheets, menus — one step above the canvas. */
  'bg-surface': string;
  /** Nested surfaces: table headers, inset panels, code blocks. */
  'bg-subtle': string;
  /** Hover state for rows and ghost buttons. */
  'bg-hover': string;
  'bg-primary': string;
  'bg-primary-hover': string;
  'bg-primary-subtle': string;
  'bg-accent': string;
  'bg-accent-subtle': string;
  'bg-success-subtle': string;
  'bg-warning-subtle': string;
  'bg-danger-subtle': string;
  'bg-info-subtle': string;
  'bg-success': string;
  'bg-warning': string;
  'bg-danger': string;
  'bg-info': string;
  /** Primary body copy. */
  'text-primary': string;
  /** Secondary copy, labels, captions — still >= 4.5:1. */
  'text-muted': string;
  /** Disabled/placeholder only. Never used for meaningful content. */
  'text-subtle': string;
  'text-on-primary': string;
  'text-on-accent': string;
  'text-brand': string;
  'text-success': string;
  'text-warning': string;
  'text-danger': string;
  'text-info': string;
  /** Decorative dividers. */
  'border-subtle': string;
  /** Default component borders. */
  'border-default': string;
  /** Borders that must carry 3:1 on their own. */
  'border-strong': string;
  'border-primary': string;
  'ring-focus': string;
}

/** The logo's own background, lifted a touch so pure-white cards separate from it. */
const CANVAS = '#F7F8F7';

export const lightTheme: SemanticTheme = {
  'bg-canvas': CANVAS,
  'bg-surface': '#FFFFFF',
  'bg-subtle': neutral[100],
  'bg-hover': neutral[100],
  'bg-primary': green[600],
  'bg-primary-hover': green[700],
  'bg-primary-subtle': green[50],
  'bg-accent': gold[400],
  'bg-accent-subtle': gold[100],
  'bg-success-subtle': success[50],
  'bg-warning-subtle': warning[50],
  'bg-danger-subtle': danger[50],
  'bg-info-subtle': info[50],
  'bg-success': success[700],
  'bg-warning': warning[700],
  'bg-danger': danger[600],
  'bg-info': info[600],
  'text-primary': neutral[950],
  'text-muted': neutral[600],
  'text-subtle': neutral[500],
  'text-on-primary': '#FFFFFF',
  'text-on-accent': neutral[950],
  'text-brand': green[600],
  'text-success': success[700],
  'text-warning': warning[700],
  'text-danger': danger[700],
  'text-info': info[700],
  'border-subtle': neutral[200],
  'border-default': neutral[300],
  'border-strong': neutral[600],
  'border-primary': green[600],
  'ring-focus': green[600],
};

/**
 * Dark theme is not an inversion. Nigerian users on OLED phones in bright sun
 * need surfaces that stay distinguishable, so we step lightness rather than
 * flipping it, and we move brand/semantic colours *up* the ramp (600 -> 300)
 * because saturated darks disappear against a dark canvas.
 */
export const darkTheme: SemanticTheme = {
  'bg-canvas': neutral[950],
  'bg-surface': '#1D231F',
  'bg-subtle': '#252C27',
  'bg-hover': '#2C342E',
  'bg-primary': green[300],
  'bg-primary-hover': green[200],
  'bg-primary-subtle': 'rgba(0, 102, 52, 0.24)',
  'bg-accent': gold[400],
  'bg-accent-subtle': 'rgba(252, 207, 2, 0.16)',
  'bg-success-subtle': 'rgba(6, 129, 63, 0.20)',
  'bg-warning-subtle': 'rgba(180, 83, 9, 0.22)',
  'bg-danger-subtle': 'rgba(198, 40, 40, 0.22)',
  'bg-info-subtle': 'rgba(29, 78, 216, 0.24)',
  'bg-success': success[300],
  'bg-warning': warning[300],
  'bg-danger': danger[300],
  'bg-info': info[300],
  'text-primary': neutral[100],
  'text-muted': neutral[400],
  'text-subtle': neutral[500],
  // On dark, primary/accent fills are light, so their foreground flips to ink.
  'text-on-primary': neutral[950],
  'text-on-accent': neutral[950],
  'text-brand': green[300],
  'text-success': success[300],
  'text-warning': warning[300],
  'text-danger': danger[300],
  'text-info': info[300],
  'border-subtle': 'rgba(255, 255, 255, 0.08)',
  'border-default': 'rgba(255, 255, 255, 0.14)',
  'border-strong': neutral[500],
  'border-primary': green[300],
  'ring-focus': green[300],
};

/**
 * Type scale. Geist is the primary face — a grotesque with the same engineered
 * neutrality as the Vercel/Linear family, which is the register this product is
 * aiming at. Numbers matter more here than in most products (balances, premiums,
 * RSA numbers), so tabular figures are mandatory on any numeric surface.
 */
export const typography = {
  fonts: {
    sans: "'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'Geist Mono', ui-monospace, 'SF Mono', 'Roboto Mono', monospace",
  },
  // Fluid where it earns it: display sizes shrink on small screens, body does not.
  scale: {
    'display-lg': { size: 'clamp(2.25rem, 1.6rem + 2.4vw, 3.25rem)', height: '1.06', tracking: '-0.03em', weight: 600 },
    'display-sm': { size: 'clamp(1.75rem, 1.4rem + 1.4vw, 2.25rem)', height: '1.12', tracking: '-0.025em', weight: 600 },
    'heading-lg': { size: '1.5rem', height: '1.25', tracking: '-0.02em', weight: 600 },
    'heading-md': { size: '1.25rem', height: '1.3', tracking: '-0.015em', weight: 600 },
    'heading-sm': { size: '1.0625rem', height: '1.35', tracking: '-0.01em', weight: 600 },
    'body-lg': { size: '1rem', height: '1.6', tracking: '0', weight: 400 },
    'body-md': { size: '0.9375rem', height: '1.55', tracking: '0', weight: 400 },
    'body-sm': { size: '0.875rem', height: '1.5', tracking: '0', weight: 400 },
    caption: { size: '0.8125rem', height: '1.45', tracking: '0.005em', weight: 400 },
    // All-caps micro labels need positive tracking or they set as a solid block.
    overline: { size: '0.6875rem', height: '1.4', tracking: '0.08em', weight: 600 },
    // Balances and money. Tabular so digits do not jitter as values update.
    numeric: { size: '1.75rem', height: '1.15', tracking: '-0.02em', weight: 600 },
  },
} as const;

/** 4px base grid. Everything in the UI lands on a multiple of it. */
export const spacing = {
  0: '0', px: '1px', 0.5: '0.125rem', 1: '0.25rem', 1.5: '0.375rem', 2: '0.5rem',
  2.5: '0.625rem', 3: '0.75rem', 4: '1rem', 5: '1.25rem', 6: '1.5rem', 7: '1.75rem',
  8: '2rem', 10: '2.5rem', 12: '3rem', 16: '4rem', 20: '5rem', 24: '6rem', 32: '8rem',
} as const;

/**
 * The logo's diamond is a hard-edged rotated square, so we stay away from
 * pill-shaped everything. Controls are gently rounded; cards get a larger
 * radius to feel like physical cards.
 */
export const radius = {
  none: '0', xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px', '2xl': '20px',
  '3xl': '28px', full: '9999px',
} as const;

/**
 * Shadows are tinted with the brand hue instead of pure black — neutral-black
 * shadows over a warm-grey canvas read as dirty. Kept shallow; elevation comes
 * mostly from borders and surface steps, as in Linear and Stripe.
 */
export const elevation = {
  none: 'none',
  xs: '0 1px 2px 0 rgba(11, 26, 18, 0.05)',
  sm: '0 1px 3px 0 rgba(11, 26, 18, 0.07), 0 1px 2px -1px rgba(11, 26, 18, 0.06)',
  md: '0 4px 12px -2px rgba(11, 26, 18, 0.08), 0 2px 4px -2px rgba(11, 26, 18, 0.05)',
  lg: '0 12px 28px -6px rgba(11, 26, 18, 0.12), 0 4px 10px -4px rgba(11, 26, 18, 0.06)',
  xl: '0 24px 48px -12px rgba(11, 26, 18, 0.18)',
  focus: '0 0 0 3px rgba(0, 102, 52, 0.28)',
} as const;

/**
 * Motion. Durations are short because this is a utility product people open to
 * do one task. Every one of these is disabled under prefers-reduced-motion.
 */
export const motion = {
  duration: { instant: '80ms', fast: '140ms', normal: '220ms', slow: '340ms', deliberate: '520ms' },
  easing: {
    // Default for most UI transitions.
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    // Elements entering the screen decelerate.
    entrance: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    // Elements leaving accelerate out.
    exit: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

export const breakpoints = {
  sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px',
} as const;

/** Z-index ladder, declared once so nothing has to guess a number. */
export const zIndex = {
  base: 0, raised: 10, sticky: 100, header: 200, drawer: 300, overlay: 400,
  modal: 500, popover: 600, toast: 700, tooltip: 800,
} as const;

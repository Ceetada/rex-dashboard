import type { Config } from 'tailwindcss';

/**
 * Tailwind is wired to the *semantic* CSS variables, not to hex values.
 *
 * That means `bg-surface` resolves to `var(--color-bg-surface)`, which is
 * redefined by the dark theme — so a component written once works in both
 * themes with no `dark:` variant at all. The `dark:` prefix should be
 * essentially absent from this codebase; if it starts appearing, a semantic
 * token is missing.
 *
 * The raw palette is exposed under `brand-*` for the rare case that genuinely
 * needs a specific stop (charts, illustrations), but components should reach
 * for the semantic names.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--color-bg-canvas)',
        surface: 'var(--color-bg-surface)',
        subtle: 'var(--color-bg-subtle)',
        hover: 'var(--color-bg-hover)',
        primary: {
          DEFAULT: 'var(--color-bg-primary)',
          hover: 'var(--color-bg-primary-hover)',
          subtle: 'var(--color-bg-primary-subtle)',
          fg: 'var(--color-text-on-primary)',
        },
        accent: {
          DEFAULT: 'var(--color-bg-accent)',
          subtle: 'var(--color-bg-accent-subtle)',
          fg: 'var(--color-text-on-accent)',
        },
        success: { DEFAULT: 'var(--color-bg-success)', subtle: 'var(--color-bg-success-subtle)', fg: 'var(--color-text-success)' },
        warning: { DEFAULT: 'var(--color-bg-warning)', subtle: 'var(--color-bg-warning-subtle)', fg: 'var(--color-text-warning)' },
        danger: { DEFAULT: 'var(--color-bg-danger)', subtle: 'var(--color-bg-danger-subtle)', fg: 'var(--color-text-danger)' },
        info: { DEFAULT: 'var(--color-bg-info)', subtle: 'var(--color-bg-info-subtle)', fg: 'var(--color-text-info)' },
        content: {
          DEFAULT: 'var(--color-text-primary)',
          muted: 'var(--color-text-muted)',
          subtle: 'var(--color-text-subtle)',
          brand: 'var(--color-text-brand)',
        },
        line: {
          subtle: 'var(--color-border-subtle)',
          DEFAULT: 'var(--color-border-default)',
          strong: 'var(--color-border-strong)',
          primary: 'var(--color-border-primary)',
        },
        // Raw ramps, for charts and illustration only.
        brand: {
          50: 'var(--palette-green-50)', 100: 'var(--palette-green-100)', 200: 'var(--palette-green-200)',
          300: 'var(--palette-green-300)', 400: 'var(--palette-green-400)', 500: 'var(--palette-green-500)',
          600: 'var(--palette-green-600)', 700: 'var(--palette-green-700)', 800: 'var(--palette-green-800)',
          900: 'var(--palette-green-900)', 950: 'var(--palette-green-950)',
        },
        gold: {
          50: 'var(--palette-gold-50)', 100: 'var(--palette-gold-100)', 200: 'var(--palette-gold-200)',
          300: 'var(--palette-gold-300)', 400: 'var(--palette-gold-400)', 500: 'var(--palette-gold-500)',
          600: 'var(--palette-gold-600)', 700: 'var(--palette-gold-700)', 800: 'var(--palette-gold-800)',
          900: 'var(--palette-gold-900)', 950: 'var(--palette-gold-950)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        'display-lg': ['var(--font-size-display-lg)', { lineHeight: 'var(--line-height-display-lg)', letterSpacing: 'var(--tracking-display-lg)', fontWeight: '600' }],
        'display-sm': ['var(--font-size-display-sm)', { lineHeight: 'var(--line-height-display-sm)', letterSpacing: 'var(--tracking-display-sm)', fontWeight: '600' }],
        'heading-lg': ['var(--font-size-heading-lg)', { lineHeight: 'var(--line-height-heading-lg)', letterSpacing: 'var(--tracking-heading-lg)', fontWeight: '600' }],
        'heading-md': ['var(--font-size-heading-md)', { lineHeight: 'var(--line-height-heading-md)', letterSpacing: 'var(--tracking-heading-md)', fontWeight: '600' }],
        'heading-sm': ['var(--font-size-heading-sm)', { lineHeight: 'var(--line-height-heading-sm)', letterSpacing: 'var(--tracking-heading-sm)', fontWeight: '600' }],
        'body-lg': ['var(--font-size-body-lg)', { lineHeight: 'var(--line-height-body-lg)' }],
        'body-md': ['var(--font-size-body-md)', { lineHeight: 'var(--line-height-body-md)' }],
        'body-sm': ['var(--font-size-body-sm)', { lineHeight: 'var(--line-height-body-sm)' }],
        caption: ['var(--font-size-caption)', { lineHeight: 'var(--line-height-caption)' }],
        overline: ['var(--font-size-overline)', { lineHeight: 'var(--line-height-overline)', letterSpacing: 'var(--tracking-overline)', fontWeight: '600' }],
        numeric: ['var(--font-size-numeric)', { lineHeight: 'var(--line-height-numeric)', letterSpacing: 'var(--tracking-numeric)', fontWeight: '600' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)', sm: 'var(--radius-sm)', md: 'var(--radius-md)',
        lg: 'var(--radius-lg)', xl: 'var(--radius-xl)', '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)', sm: 'var(--shadow-sm)', md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)', xl: 'var(--shadow-xl)', focus: 'var(--shadow-focus)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        entrance: 'var(--ease-entrance)',
        exit: 'var(--ease-exit)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        instant: 'var(--duration-instant)', fast: 'var(--duration-fast)',
        normal: 'var(--duration-normal)', slow: 'var(--duration-slow)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // Used on skeletons. Deliberately slow — a fast shimmer reads as an
        // error state rather than as loading.
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up var(--duration-normal) var(--ease-entrance) both',
        shimmer: 'shimmer 1.8s infinite',
      },
    },
  },
  plugins: [],
};

export default config;

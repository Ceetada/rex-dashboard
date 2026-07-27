'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * The focus ring is not optional and not a variant.
 *
 * `focus-visible` (not `focus`) so it appears for keyboard users without
 * flashing on every mouse click. The offset ring against the surface gives a
 * 3:1 indicator in both themes — verified by the token contrast tests.
 */
const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-fast ease-standard',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-surface)]',
    'disabled:pointer-events-none disabled:opacity-50',
    // A very slight press. Enough to feel responsive on a touch device, small
    // enough that it never reads as a bug.
    'active:scale-[0.985]',
    '[&_svg]:size-4 [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-xs',
        secondary: 'bg-surface text-content border border-line hover:bg-hover shadow-xs',
        ghost: 'text-content-muted hover:bg-hover hover:text-content',
        // Gold is reserved for genuine emphasis — a single "upgrade" style
        // call to action per screen, never for routine buttons.
        accent: 'bg-accent text-accent-fg hover:brightness-95 shadow-xs',
        danger: 'bg-danger text-white hover:brightness-110 shadow-xs',
        link: 'text-content-brand underline-offset-4 hover:underline',
      },
      size: {
        // 44px — the minimum comfortable touch target, and this product is
        // used on phones far more than on desktops.
        md: 'h-11 px-4 text-body-sm rounded-md',
        sm: 'h-9 px-3 text-body-sm rounded-sm',
        lg: 'h-12 px-6 text-body-md rounded-lg',
        icon: 'h-10 w-10 rounded-md',
      },
      fullWidth: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
  /** Announced to screen readers while loading. */
  loadingText?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, asChild, loading, loadingText, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        // A loading button must be unclickable, or a slow network turns one
        // airtime purchase into three.
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            <span>{loadingText ?? children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };

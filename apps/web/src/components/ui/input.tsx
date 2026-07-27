'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Persistent helper text. Replaced visually by `error` when present. */
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Hides the label visually but keeps it for screen readers. Use sparingly. */
  hideLabel?: boolean;
}

/**
 * A text field that is accessible by construction rather than by convention.
 *
 * `label` is required, not optional — a placeholder is not a label, and making
 * the prop mandatory is the only reliable way to stop unlabelled inputs
 * appearing. The error is wired through `aria-describedby` and announced
 * politely, and `aria-invalid` marks the field itself so assistive tech does
 * not rely on the red border it cannot see.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, leading, trailing, hideLabel, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className={cn(
            'text-body-sm font-medium text-content',
            hideLabel && 'sr-only',
          )}
        >
          {label}
          {props.required && (
            <span className="ml-0.5 text-danger-fg" aria-hidden>
              *
            </span>
          )}
        </label>

        <div className="relative">
          {leading && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted [&_svg]:size-4">
              {leading}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? true : undefined}
            aria-describedby={cn(error ? errorId : undefined, hint ? hintId : undefined) || undefined}
            className={cn(
              'h-11 w-full rounded-md border bg-surface px-3 text-body-md text-content',
              // Placeholders use the muted stop, not the subtle one — a
              // placeholder is still text a user has to read.
              'placeholder:text-content-muted',
              'transition-[border-color,box-shadow] duration-fast ease-standard',
              'focus:outline-none focus:ring-2 focus:ring-[var(--color-ring-focus)] focus:ring-offset-1 focus:ring-offset-[var(--color-bg-surface)]',
              'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-content-muted',
              error ? 'border-[var(--color-bg-danger)]' : 'border-line',
              leading && 'pl-9',
              trailing && 'pr-10',
              className,
            )}
            {...props}
          />
          {trailing && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted [&_svg]:size-4">
              {trailing}
            </span>
          )}
        </div>

        {error ? (
          // role="alert" so a validation failure is announced the moment it
          // appears, not only when the field is next focused.
          <p id={errorId} role="alert" className="text-caption text-danger-fg">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-caption text-content-muted">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';

/**
 * Money input.
 *
 * Two decisions worth noting: the field is `inputMode="decimal"` so Android
 * shows a numeric keypad, and the naira sign is rendered as a static adornment
 * rather than typed into the value — users should never have to delete a
 * currency symbol to enter an amount.
 */
export const AmountInput = forwardRef<HTMLInputElement, Omit<InputProps, 'leading' | 'type'>>(
  (props, ref) => (
    <Input
      ref={ref}
      type="text"
      inputMode="decimal"
      leading={<span className="text-body-md font-medium">₦</span>}
      className="font-mono tabular-nums"
      {...props}
    />
  ),
);
AmountInput.displayName = 'AmountInput';

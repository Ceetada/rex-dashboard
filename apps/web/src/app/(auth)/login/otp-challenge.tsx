'use client';

import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError, post } from '@/lib/api';
import { cn } from '@/lib/cn';

interface OtpChallengeProps {
  challengeId: string;
  destination: string;
  kind: 'otp' | '2fa';
  onCancel: () => void;
}

const LENGTH = 6;

/**
 * The six-digit code step.
 *
 * Rendered as six boxes but backed by **one** logical value. Six separate
 * inputs is the common implementation and it breaks the two things that
 * matter most here: Android's SMS autofill needs a single field carrying
 * `autocomplete="one-time-code"`, and pasting a copied code should fill the
 * whole thing rather than dropping five digits on the floor.
 *
 * The visible boxes are presentational; a transparent input sits over them.
 */
export function OtpChallenge({ challengeId, destination, kind, onCancel }: OtpChallengeProps) {
  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(45);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  const verify = useMutation({
    mutationFn: (value: string) =>
      post<{ status: string }>('/auth/verify-otp', { challengeId, code: value }),
    onSuccess: (result) => {
      if (result.status === 'AUTHENTICATED') window.location.assign('/dashboard');
    },
  });

  const submit = (value: string) => {
    if (value.length === LENGTH && !verify.isPending) verify.mutate(value);
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, LENGTH);
    setCode(digits);
    // Auto-submit on the sixth digit. Asking someone to type six digits and
    // then find a button is one interaction too many on a phone.
    if (digits.length === LENGTH) submit(digits);
  };

  const error = verify.error instanceof ApiError ? verify.error : null;
  const attemptsLeft = (error?.fields as unknown as { attemptsRemaining?: number })?.attemptsRemaining;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary-subtle text-content-brand">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-heading-lg text-content">Verify it&rsquo;s you</h1>
          <p className="text-body-md text-content-muted">
            {kind === '2fa' ? destination : <>We sent a code to {destination}</>}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="relative">
          <label htmlFor="otp" className="sr-only">
            Six-digit verification code
          </label>
          <input
            ref={inputRef}
            id="otp"
            value={code}
            onChange={(e) => onChange(e.target.value)}
            inputMode="numeric"
            // The attribute Android and iOS look for to offer the code from SMS.
            autoComplete="one-time-code"
            maxLength={LENGTH}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'otp-error' : undefined}
            className="absolute inset-0 z-10 h-full w-full cursor-default opacity-0"
          />
          <div className="pointer-events-none flex justify-between gap-2" aria-hidden>
            {Array.from({ length: LENGTH }).map((_, index) => {
              const filled = index < code.length;
              const active = index === code.length;
              return (
                <div
                  key={index}
                  className={cn(
                    'flex h-14 flex-1 items-center justify-center rounded-lg border-2 text-heading-md font-semibold tabular-nums transition-[border-color,background-color] duration-fast',
                    error
                      ? 'border-[var(--color-bg-danger)] bg-danger-subtle text-danger-fg'
                      : filled
                        ? 'border-[var(--color-border-primary)] bg-primary-subtle text-content'
                        : active
                          ? 'border-[var(--color-border-primary)] bg-surface text-content'
                          : 'border-line bg-surface text-content',
                  )}
                >
                  {code[index] ?? ''}
                </div>
              );
            })}
          </div>
        </div>

        {error && (
          <p id="otp-error" role="alert" className="text-center text-body-sm text-danger-fg">
            {error.message}
            {typeof attemptsLeft === 'number' && attemptsLeft > 0 && (
              <span className="text-content-muted">
                {' '}
                — {attemptsLeft} attempt{attemptsLeft === 1 ? '' : 's'} left
              </span>
            )}
          </p>
        )}

        <p className="text-center text-body-sm text-content-muted">
          {secondsLeft > 0 ? (
            <>Resend in 0:{String(secondsLeft).padStart(2, '0')}</>
          ) : (
            <button
              type="button"
              className="rounded-sm font-medium text-content-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
              onClick={() => setSecondsLeft(45)}
            >
              Send a new code
            </button>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          loading={verify.isPending}
          loadingText="Verifying…"
          disabled={code.length < LENGTH}
          onClick={() => submit(code)}
        >
          Verify
        </Button>
        <Button variant="ghost" size="sm" fullWidth onClick={onCancel}>
          Back to sign in
        </Button>
      </div>
    </div>
  );
}

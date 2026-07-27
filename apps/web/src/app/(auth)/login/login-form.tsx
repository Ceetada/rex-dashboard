'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema, type LoginResult } from '@evas/contracts';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, post } from '@/lib/api';
import { OtpChallenge } from './otp-challenge';

type LoginValues = z.input<typeof loginSchema>;

/**
 * Sign in.
 *
 * Login has three possible outcomes, not two, and this component handles all
 * of them: straight through, a 2FA challenge, or a step-up because the device
 * is unrecognised. The last one fires even when 2FA is off — most account
 * takeovers present entirely valid credentials from a new device.
 */
export function LoginForm() {
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const [challenge, setChallenge] = useState<
    { challengeId: string; destination: string; kind: 'otp' | '2fa'; hint?: string } | null
  >(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  const login = useMutation({
    mutationFn: (values: LoginValues) => post<LoginResult>('/auth/login', values),
    onSuccess: (result) => {
      if (result.status === 'AUTHENTICATED') {
        // A full navigation, not router.push — the session cookie was just set
        // and every server component needs to re-render with it.
        window.location.assign('/dashboard');
        return;
      }
      if (result.status === 'TWO_FACTOR_REQUIRED') {
        setChallenge({
          challengeId: result.challengeId,
          destination: result.hint,
          kind: '2fa',
          hint: result.hint,
        });
        return;
      }
      setChallenge({
        challengeId: result.challengeId,
        destination: result.destination,
        kind: 'otp',
      });
    },
  });

  const error = login.error instanceof ApiError ? login.error : null;

  if (challenge) {
    return (
      <OtpChallenge
        challengeId={challenge.challengeId}
        destination={challenge.destination}
        kind={challenge.kind}
        onCancel={() => setChallenge(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-display-sm text-content">Welcome back</h1>
        <p className="text-body-md text-content-muted">Sign in to your account</p>
      </div>

      <form
        onSubmit={handleSubmit((values) => login.mutate(values))}
        className="flex flex-col gap-5"
        noValidate
      >
        <Input
          label="Email"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          leading={<Mail />}
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type={revealed ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder="••••••••••"
          leading={<Lock />}
          error={errors.password?.message}
          trailing={
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              // The label describes what the control will do, and changes with
              // state — a static "toggle password" tells a screen-reader user
              // nothing about which state they are in.
              aria-label={revealed ? 'Hide password' : 'Show password'}
              className="rounded-sm p-0.5 text-content-muted transition-colors duration-fast hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          }
          {...register('password')}
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2.5 text-body-sm text-content">
            <input
              type="checkbox"
              className="size-4 rounded-xs border-line text-[var(--color-bg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
              {...register('rememberMe')}
            />
            Keep me signed in
          </label>
          <a
            href="/forgot-password"
            className="rounded-sm text-body-sm text-content-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
          >
            Forgot password?
          </a>
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-[var(--color-bg-danger)] bg-danger-subtle p-4">
            <p className="text-body-sm font-medium text-danger-fg">{error.message}</p>
            {error.requestId && (
              <p className="mt-2 font-mono text-caption text-content-muted">
                Reference: {error.requestId}
              </p>
            )}
          </div>
        )}

        <Button type="submit" size="lg" fullWidth loading={login.isPending} loadingText="Signing in…">
          Sign in
        </Button>
      </form>

      <p className="text-center text-body-sm text-content-muted">
        New to Evas?{' '}
        <a
          href="/signup"
          className="rounded-sm font-medium text-content-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
        >
          Create an account
        </a>
      </p>
    </div>
  );
}

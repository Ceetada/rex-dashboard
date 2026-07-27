'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { CheckCircle2, Phone } from 'lucide-react';
import { buyAirtimeSchema, detectNetwork, formatNaira, nairaToKobo, type Network } from '@evas/contracts';
import type { z } from 'zod';

import { NetworkPicker } from '@/components/services/network-picker';
import { Button } from '@/components/ui/button';
import { AmountInput, Input } from '@/components/ui/input';
import { ApiError, newIdempotencyKey, post } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Amounts people actually buy. Saves typing on the overwhelming majority of purchases. */
const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

/**
 * The schema transforms `phone` (any Nigerian format in, E.164 out), so the
 * form's value type is the schema *input*, not its output. Using z.infer here
 * would type the field as the already-normalised value the user never types.
 */
type AirtimeFormValues = z.input<typeof buyAirtimeSchema>;

interface SavedRecipient {
  id: string;
  label: string;
  network: string | null;
  recipientMasked: string;
}

/**
 * Buy airtime.
 *
 * Three things here are load-bearing rather than decorative:
 *
 *  1. The idempotency key is generated once, when the form mounts, and reused
 *     for every retry of the same purchase. A user on a flaky connection who
 *     taps "Buy" twice must not be charged twice — and this is the client half
 *     of that guarantee.
 *
 *  2. The network is inferred from the number as it is typed, but remains
 *     overridable. Ported numbers exist, so auto-detection must never be a
 *     lock — it is a shortcut with an escape hatch.
 *
 *  3. Validation uses the exact schema the server uses. There is no second,
 *     drifting copy of "what counts as a valid Nigerian number" in this file.
 */
export function AirtimeForm({ recipients }: { recipients: SavedRecipient[] }) {
  const [network, setNetwork] = useState<Network | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [success, setSuccess] = useState<{ reference: string; status: string } | null>(null);

  // Generated once per form instance, deliberately not per submit.
  const idempotencyKey = useRef(newIdempotencyKey());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AirtimeFormValues>({
    resolver: zodResolver(buyAirtimeSchema),
    defaultValues: {
      idempotencyKey: idempotencyKey.current,
      amountKobo: 0,
      phone: '',
      saveRecipient: false,
    },
  });

  const phone = watch('phone');
  const amountKobo = watch('amountKobo');

  // Infer the network as the number is typed. Only overrides the selection
  // while the user has not chosen one manually.
  useEffect(() => {
    const detected = detectNetwork(phone ?? '');
    if (detected && (autoDetected || network === null)) {
      setNetwork(detected);
      setValue('network', detected);
      setAutoDetected(true);
    }
  }, [phone, autoDetected, network, setValue]);

  const purchase = useMutation({
    mutationFn: (values: AirtimeFormValues) =>
      post<{ reference: string; status: string }>('/services/airtime', values, idempotencyKey.current),
    onSuccess: (result) => setSuccess(result),
  });

  const chooseNetwork = (value: Network) => {
    setNetwork(value);
    setAutoDetected(false); // an explicit choice wins over detection from here on
    setValue('network', value);
  };

  const error = purchase.error instanceof ApiError ? purchase.error : null;

  if (success) {
    return <PurchaseReceipt reference={success.reference} status={success.status} />;
  }

  return (
    <form
      onSubmit={handleSubmit((values) => purchase.mutate(values))}
      className="flex flex-col gap-6"
      noValidate
    >
      {recipients.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-body-sm font-medium text-content">Recent numbers</p>
          <div className="flex flex-wrap gap-2">
            {recipients.slice(0, 5).map((recipient) => (
              <button
                key={recipient.id}
                type="button"
                onClick={() => setValue('phone', recipient.recipientMasked)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-caption text-content transition-colors duration-fast hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
              >
                <span className="font-medium">{recipient.label}</span>
                <span className="ml-1.5 text-content-muted">{recipient.recipientMasked}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Input
        label="Phone number"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="0803 123 4567"
        leading={<Phone />}
        error={errors.phone?.message}
        hint="We accept 0803…, +234803… or 803…"
        {...register('phone')}
      />

      <NetworkPicker value={network} onChange={chooseNetwork} autoDetected={autoDetected} />

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {QUICK_AMOUNTS.map((naira) => {
            const selected = amountKobo === nairaToKobo(naira);
            return (
              <button
                key={naira}
                type="button"
                onClick={() => setValue('amountKobo', nairaToKobo(naira))}
                aria-pressed={selected}
                className={cn(
                  'rounded-lg border-2 py-2.5 text-body-sm font-medium tabular-nums',
                  'transition-[border-color,background-color] duration-fast ease-standard',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]',
                  selected
                    ? 'border-[var(--color-border-primary)] bg-primary-subtle text-content-brand'
                    : 'border-transparent bg-subtle text-content hover:bg-hover',
                )}
              >
                {formatNaira(nairaToKobo(naira))}
              </button>
            );
          })}
        </div>

        <AmountInput
          label="Or enter an amount"
          placeholder="0"
          error={errors.amountKobo?.message}
          hint="Between ₦50 and ₦50,000"
          onChange={(event) => {
            const naira = Number(event.target.value.replace(/[^\d.]/g, ''));
            setValue('amountKobo', Number.isFinite(naira) ? nairaToKobo(naira) : 0);
          }}
        />
      </div>

      <label className="flex items-center gap-2.5 text-body-sm text-content">
        <input
          type="checkbox"
          className="size-4 rounded-xs border-line text-[var(--color-bg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)]"
          {...register('saveRecipient')}
        />
        Save this number for next time
      </label>

      {error && (
        <div role="alert" className="rounded-lg border border-[var(--color-bg-danger)] bg-danger-subtle p-4">
          <p className="text-body-sm font-medium text-danger-fg">{error.message}</p>
          {error.code === 'INSUFFICIENT_FUNDS' && (
            <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0">
              <a href="/wallet/top-up">Top up your wallet</a>
            </Button>
          )}
          {error.requestId && (
            // Surfaced so a user can quote it to support instead of describing
            // the problem from memory.
            <p className="mt-2 font-mono text-caption text-content-muted">
              Reference: {error.requestId}
            </p>
          )}
        </div>
      )}

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={purchase.isPending}
        loadingText="Buying airtime…"
        disabled={!network || !amountKobo}
      >
        {amountKobo ? `Buy ${formatNaira(amountKobo)} airtime` : 'Buy airtime'}
      </Button>
    </form>
  );
}

/**
 * The receipt.
 *
 * Note the third state. A purchase can land in "confirming" when the network
 * has not yet told us whether it went through, and the honest thing is to say
 * so — with the promise of an automatic refund — rather than showing a green
 * tick we cannot stand behind.
 */
function PurchaseReceipt({ reference, status }: { reference: string; status: string }) {
  const pending = status === 'REQUIRES_RECONCILIATION' || status === 'PROCESSING';

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-line-subtle bg-surface px-6 py-10 text-center">
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full',
          pending ? 'bg-info-subtle text-info-fg' : 'bg-success-subtle text-success-fg',
        )}
      >
        <CheckCircle2 className="size-7" aria-hidden />
      </span>

      <div>
        <h2 className="text-heading-md text-content">
          {pending ? 'Confirming your purchase' : 'Airtime delivered'}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-body-sm text-content-muted">
          {pending
            ? 'We are confirming this with the network. If it did not go through, we will refund your wallet automatically — you do not need to do anything.'
            : 'The airtime has been credited to the number.'}
        </p>
      </div>

      <p className="font-mono text-caption text-content-muted">{reference}</p>

      <div className="mt-2 flex gap-3">
        <Button asChild variant="secondary" size="sm">
          <a href="/services/history">View history</a>
        </Button>
        <Button asChild size="sm">
          <a href="/dashboard">Done</a>
        </Button>
      </div>
    </div>
  );
}

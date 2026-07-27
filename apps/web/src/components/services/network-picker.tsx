'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { Network } from '@evas/contracts';

/**
 * Network selection.
 *
 * Networks are the one place brand colour belongs to someone else — MTN yellow,
 * Airtel red, Glo green, 9mobile green are how Nigerians identify their line at
 * a glance, and overriding them with our palette would make the control slower
 * to use. They are confined to this component and never leak into the token
 * system.
 *
 * Selection is shown by a checkmark and a ring, not by colour alone.
 */
const NETWORKS: Array<{ value: Network; label: string; className: string; textClass: string }> = [
  { value: 'MTN', label: 'MTN', className: 'bg-[#FFCC00]', textClass: 'text-black' },
  { value: 'AIRTEL', label: 'Airtel', className: 'bg-[#E4002B]', textClass: 'text-white' },
  { value: 'GLO', label: 'Glo', className: 'bg-[#00A651]', textClass: 'text-white' },
  { value: 'NINE_MOBILE', label: '9mobile', className: 'bg-[#006F3C]', textClass: 'text-white' },
];

interface NetworkPickerProps {
  value: Network | null;
  onChange: (network: Network) => void;
  /** True when the network was inferred from the phone number rather than tapped. */
  autoDetected?: boolean;
}

export function NetworkPicker({ value, onChange, autoDetected }: NetworkPickerProps) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-body-sm font-medium text-content">
        Network
        {autoDetected && value && (
          <span className="ml-2 font-normal text-content-muted">
            — detected from the number
          </span>
        )}
      </legend>

      {/* A radiogroup, not a row of buttons: arrow keys must move between options. */}
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Mobile network">
        {NETWORKS.map((network) => {
          const selected = value === network.value;
          return (
            <button
              key={network.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(network.value)}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-lg border-2 p-3',
                'transition-[border-color,transform,box-shadow] duration-fast ease-standard',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg-surface)]',
                selected
                  ? 'border-[var(--color-border-primary)] bg-primary-subtle'
                  : 'border-transparent bg-subtle hover:bg-hover',
              )}
            >
              <span
                className={cn(
                  'flex size-10 items-center justify-center rounded-full text-caption font-bold',
                  network.className,
                  network.textClass,
                )}
                aria-hidden
              >
                {network.value === 'NINE_MOBILE' ? '9' : network.label.slice(0, 3)}
              </span>
              <span className="text-caption font-medium text-content">{network.label}</span>

              {selected && (
                <span
                  className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--color-bg-primary)] text-[var(--color-text-on-primary)]"
                  aria-hidden
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

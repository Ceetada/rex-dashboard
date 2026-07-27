import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

/**
 * Status is never communicated by colour alone — every status badge in this
 * product pairs its tint with a word. Colour-blind users and anyone glancing at
 * a phone in sunlight both depend on the label, not the hue.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-subtle text-content-muted',
        brand: 'bg-primary-subtle text-content-brand',
        success: 'bg-success-subtle text-success-fg',
        warning: 'bg-warning-subtle text-warning-fg',
        danger: 'bg-danger-subtle text-danger-fg',
        info: 'bg-info-subtle text-info-fg',
        accent: 'bg-accent-subtle text-content',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/** Maps every domain status onto a tone and a human label, in one place. */
export function statusTone(status: string): { tone: BadgeProps['tone']; label: string } {
  const map: Record<string, { tone: BadgeProps['tone']; label: string }> = {
    ACTIVE: { tone: 'success', label: 'Active' },
    SUCCESSFUL: { tone: 'success', label: 'Successful' },
    DELIVERED: { tone: 'success', label: 'Delivered' },
    PENDING: { tone: 'warning', label: 'Pending' },
    PROCESSING: { tone: 'warning', label: 'Processing' },
    PENDING_PAYMENT: { tone: 'warning', label: 'Awaiting payment' },
    GRACE_PERIOD: { tone: 'warning', label: 'Grace period' },
    // Phrased for the person waiting on their money, not for the engineer.
    REQUIRES_RECONCILIATION: { tone: 'info', label: 'Confirming' },
    FAILED: { tone: 'danger', label: 'Failed' },
    EXPIRED: { tone: 'danger', label: 'Expired' },
    SUSPENDED: { tone: 'danger', label: 'Suspended' },
    REFUNDED: { tone: 'neutral', label: 'Refunded' },
    REVERSED: { tone: 'neutral', label: 'Reversed' },
    CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  };
  return map[status] ?? { tone: 'neutral', label: status.replace(/_/g, ' ').toLowerCase() };
}

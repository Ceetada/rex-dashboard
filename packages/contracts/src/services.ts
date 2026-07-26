/**
 * Digital services (VTU) contracts.
 *
 * Airtime, data and cable all share one shape deliberately: a recipient, a
 * product, an amount and an idempotency key. Adding electricity later means
 * adding an enum member and an adapter, not a new API surface.
 */

import { z } from 'zod';

import { NETWORKS, kobo, ngPhone, smartcardNumber } from './primitives';

export const SERVICE_TYPES = ['AIRTIME', 'DATA', 'CABLE', 'ELECTRICITY'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const CABLE_BILLERS = ['dstv', 'gotv', 'startimes'] as const;
export type CableBiller = (typeof CABLE_BILLERS)[number];

/**
 * Every purchase carries a client-generated idempotency key. Mobile networks in
 * Nigeria drop connections mid-request often enough that a user retrying a
 * "failed" purchase that actually succeeded is a routine event, not an edge
 * case — this is what stops them being charged twice.
 */
const idempotent = {
  idempotencyKey: z.string().uuid('Provide a valid idempotency key'),
};

export const buyAirtimeSchema = z.object({
  ...idempotent,
  network: z.enum(NETWORKS),
  phone: ngPhone,
  // Aggregator floors and ceilings. Below ₦50 most networks reject outright.
  amountKobo: kobo.min(5_000, 'Minimum airtime is ₦50').max(5_000_000, 'Maximum airtime is ₦50,000'),
  saveRecipient: z.boolean().default(false),
  recipientLabel: z.string().trim().max(40).optional(),
});
export type BuyAirtimeInput = z.infer<typeof buyAirtimeSchema>;

export const buyDataSchema = z.object({
  ...idempotent,
  network: z.enum(NETWORKS),
  phone: ngPhone,
  productId: z.string().uuid('Select a data plan'),
  saveRecipient: z.boolean().default(false),
  recipientLabel: z.string().trim().max(40).optional(),
});
export type BuyDataInput = z.infer<typeof buyDataSchema>;

/**
 * Cable is a two-step flow: validate the smartcard against the biller to get
 * the customer name, show it to the user for confirmation, then purchase.
 * Skipping the confirmation step is how people top up a stranger's decoder.
 */
export const validateSmartcardSchema = z.object({
  biller: z.enum(CABLE_BILLERS),
  smartcardNumber,
});

export const subscribeCableSchema = z.object({
  ...idempotent,
  biller: z.enum(CABLE_BILLERS),
  smartcardNumber,
  productId: z.string().uuid('Select a package'),
  // Echoed back from the validation step; the server re-validates rather than
  // trusting it, but it is carried so the receipt shows who was topped up.
  customerName: z.string().max(120).optional(),
  saveRecipient: z.boolean().default(false),
  recipientLabel: z.string().trim().max(40).optional(),
});
export type SubscribeCableInput = z.infer<typeof subscribeCableSchema>;

export const saveRecipientSchema = z.object({
  label: z.string().trim().min(1, 'Give this recipient a name').max(40),
  serviceType: z.enum(SERVICE_TYPES),
  network: z.enum(NETWORKS).optional(),
  billerCode: z.string().optional(),
  recipient: z.string().min(1),
  isFavourite: z.boolean().default(false),
});

// ── Response shapes ─────────────────────────────────────────────────────────

export interface ServiceProductDto {
  id: string;
  serviceType: ServiceType;
  network: string | null;
  billerCode: string | null;
  name: string;
  description: string | null;
  amountKobo: number;
  validityDays: number | null;
}

export interface SavedRecipientDto {
  id: string;
  label: string;
  serviceType: ServiceType;
  network: string | null;
  billerCode: string | null;
  /** Always masked. The full value never leaves the server. */
  recipientMasked: string;
  isFavourite: boolean;
  lastUsedAt: string | null;
  useCount: number;
}

export interface ServiceOrderDto {
  id: string;
  reference: string;
  serviceType: ServiceType;
  network: string | null;
  billerCode: string | null;
  recipientMasked: string;
  productName: string | null;
  amountKobo: number;
  status: 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'REFUNDED' | 'REQUIRES_RECONCILIATION';
  failureReason: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface SmartcardValidationDto {
  biller: CableBiller;
  smartcardNumber: string;
  customerName: string;
  currentPackage: string | null;
  dueDate: string | null;
}

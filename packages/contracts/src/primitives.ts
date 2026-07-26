/**
 * Nigeria-specific primitives.
 *
 * These live in a shared package because the frontend and backend must agree
 * *exactly* on what a valid phone number or amount is. A client that accepts
 * "08012345678" while the server demands "+2348012345678" produces a class of
 * bug that only shows up in production, on real users' phones.
 */

import { z } from 'zod';

/** Prefixes currently allocated to Nigerian mobile networks (NCC). */
const NG_MOBILE_PREFIXES = [
  // MTN
  '0703', '0704', '0706', '0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916',
  // Airtel
  '0701', '0708', '0802', '0808', '0812', '0901', '0902', '0904', '0907', '0912',
  // Glo
  '0705', '0805', '0807', '0811', '0815', '0905', '0915',
  // 9mobile
  '0809', '0817', '0818', '0908', '0909',
];

export const NETWORKS = ['MTN', 'AIRTEL', 'GLO', 'NINE_MOBILE'] as const;
export type Network = (typeof NETWORKS)[number];

const PREFIX_TO_NETWORK: Record<string, Network> = {};
for (const p of NG_MOBILE_PREFIXES) {
  const network: Network =
    ['0703','0704','0706','0803','0806','0810','0813','0814','0816','0903','0906','0913','0916'].includes(p) ? 'MTN'
    : ['0701','0708','0802','0808','0812','0901','0902','0904','0907','0912'].includes(p) ? 'AIRTEL'
    : ['0705','0805','0807','0811','0815','0905','0915'].includes(p) ? 'GLO'
    : 'NINE_MOBILE';
  PREFIX_TO_NETWORK[p] = network;
}

/**
 * Normalises every way a Nigerian writes their number into E.164.
 * Accepts 08012345678, 8012345678, +2348012345678, 2348012345678,
 * and the same with spaces or dashes.
 */
export function normaliseNgPhone(input: string): string | null {
  const digits = input.replace(/[\s()\-.]/g, '');
  let local: string;
  if (/^\+234\d{10}$/.test(digits)) local = `0${digits.slice(4)}`;
  else if (/^234\d{10}$/.test(digits)) local = `0${digits.slice(3)}`;
  else if (/^0\d{10}$/.test(digits)) local = digits;
  else if (/^\d{10}$/.test(digits)) local = `0${digits}`;
  else return null;

  if (!PREFIX_TO_NETWORK[local.slice(0, 4)]) return null;
  return `+234${local.slice(1)}`;
}

/** Infers the network from a number — used to preselect the tile on Buy Airtime. */
export function detectNetwork(phone: string): Network | null {
  const e164 = normaliseNgPhone(phone);
  if (!e164) return null;
  // +234 8012345678 -> local prefix 0801
  return PREFIX_TO_NETWORK[`0${e164.slice(4, 7)}`] ?? null;
}

export const ngPhone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const normalised = normaliseNgPhone(v);
    if (!normalised) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid Nigerian mobile number',
      });
      return z.NEVER;
    }
    return normalised;
  });

/**
 * Money, always in kobo, always an integer.
 * The UI works in naira; conversion happens exactly once, at the boundary.
 */
export const kobo = z.number().int().nonnegative();
export const nairaToKobo = (naira: number): number => Math.round(naira * 100);
export const koboToNaira = (k: number | bigint): number => Number(k) / 100;

export function formatNaira(
  amountKobo: number | bigint,
  options: { compact?: boolean; showDecimals?: boolean } = {},
): string {
  const naira = koboToNaira(amountKobo);
  const { compact = false, showDecimals = naira % 1 !== 0 } = options;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(naira);
}

/**
 * BVN and NIN are both 11 digits. They are never logged, never returned in
 * full, and never used as a lookup key in plaintext.
 */
export const bvn = z.string().regex(/^\d{11}$/, 'BVN must be 11 digits');
export const nin = z.string().regex(/^\d{11}$/, 'NIN must be 11 digits');

/** Cable smartcard/IUC numbers: 10-11 digits depending on the biller. */
export const smartcardNumber = z
  .string()
  .trim()
  .regex(/^\d{10,11}$/, 'Enter a valid smartcard or IUC number');

/** Masks an identifier for display — the only form the API ever returns. */
export function maskIdentifier(value: string, visible = 4): string {
  if (value.length <= visible) return '•'.repeat(value.length);
  return `${'•'.repeat(value.length - visible)}${value.slice(-visible)}`;
}

export function maskPhone(e164: string): string {
  const local = e164.startsWith('+234') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 4)}•••${local.slice(-4)}`;
}

/**
 * Password policy. Length is weighted far above character-class rules because
 * that is what actually resists offline cracking; we require a floor of 10 and
 * reject the passwords that appear in every Nigerian breach corpus.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', '12345678', '123456789', 'qwertyuiop', 'nigeria123',
  'iloveyou', 'letmein1', 'admin123', 'welcome1', 'abcd1234', 'naija123',
]);

export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'That is longer than 128 characters')
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), 'That password is too common')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), 'Include upper and lower case letters')
  .refine((v) => /\d/.test(v), 'Include at least one number');

export const email = z.string().trim().toLowerCase().email('Enter a valid email address');

export const otpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export const uuid = z.string().uuid();

/** Cursor pagination — offset pagination breaks on an append-heavy ledger. */
export const paginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export interface Paginated<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

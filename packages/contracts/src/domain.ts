/**
 * Health, retirement, profile and notification contracts.
 */

import { z } from 'zod';

import { kobo, ngPhone, uuid } from './primitives';

// ── Profile ─────────────────────────────────────────────────────────────────

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(2).max(60).optional(),
  lastName: z.string().trim().min(2).max(60).optional(),
  middleName: z.string().trim().max(60).nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((v) => {
      const age = (Date.now() - new Date(v).getTime()) / 31_557_600_000;
      return age >= 18 && age <= 120;
    }, 'You must be at least 18')
    .optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(80).optional(),
  stateCode: z.string().length(2).optional(),
  lgaCode: z.string().max(12).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePhoneSchema = z.object({ phone: ngPhone });

export const notificationPreferencesSchema = z.object({
  emailEnabled: z.boolean(),
  smsEnabled: z.boolean(),
  pushEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
  categoryOverrides: z
    .record(
      z.enum(['TRANSACTION', 'HEALTH', 'RETIREMENT', 'SERVICE', 'ANNOUNCEMENT', 'MARKETING']),
      z.object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        push: z.boolean().optional(),
        inApp: z.boolean().optional(),
      }),
    )
    .default({}),
  quietHoursStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quietHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  timezone: z.string().default('Africa/Lagos'),
});
// SECURITY is intentionally absent from categoryOverrides — a user cannot mute
// "your password was changed". The service layer enforces the same rule.

// ── Health ──────────────────────────────────────────────────────────────────

export const dependantSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional(),
  relationship: z.enum(['SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER']),
});

export const subscribeToPlanSchema = z.object({
  planId: uuid,
  billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).default('MONTHLY'),
  dependants: z.array(dependantSchema).max(10).default([]),
  primaryHospitalId: uuid.optional(),
  autoRenew: z.boolean().default(true),
  paymentChannel: z.enum(['WALLET', 'CARD', 'BANK_TRANSFER']).default('WALLET'),
});
export type SubscribeToPlanInput = z.infer<typeof subscribeToPlanSchema>;

export interface PlanBenefitDto {
  category: string;
  title: string;
  description: string | null;
  limitLabel: string | null;
  isIncluded: boolean;
}

export interface HealthPlanDto {
  id: string;
  slug: string;
  name: string;
  tier: 'BASIC' | 'FAMILY' | 'PREMIUM';
  tagline: string | null;
  description: string;
  premiumKobo: number;
  billingCycle: string;
  maxDependants: number;
  coverageLimitKobo: number | null;
  waitingPeriodDays: number;
  hmoProvider: { id: string; name: string; logoUrl: string | null } | null;
  hospitalCount: number;
  benefits: PlanBenefitDto[];
}

export interface HealthSubscriptionDto {
  id: string;
  plan: HealthPlanDto;
  status: string;
  /** Masked HMO member number, e.g. "•••••4821". */
  memberNumberMasked: string | null;
  startDate: string;
  renewalDate: string;
  /** Precomputed server-side so every client renders the same urgency banner. */
  daysUntilRenewal: number;
  autoRenew: boolean;
  premiumKobo: number;
  dependants: Array<{
    id: string;
    firstName: string;
    lastName: string;
    relationship: string;
    dateOfBirth: string;
    memberNumberMasked: string | null;
  }>;
}

// ── Retirement ──────────────────────────────────────────────────────────────

export const contributeSchema = z.object({
  idempotencyKey: uuid,
  amountKobo: kobo.min(100_000, 'Minimum contribution is ₦1,000'),
  source: z.enum(['MANUAL', 'AUTO_DEBIT', 'BONUS']).default('MANUAL'),
  paymentChannel: z.enum(['WALLET', 'CARD', 'BANK_TRANSFER']).default('WALLET'),
});

export const autoDebitSchema = z.object({
  enabled: z.boolean(),
  amountKobo: kobo.min(100_000).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
});
// Capped at 28 so a monthly debit never silently skips February.

export const riskProfileSchema = z.object({
  riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
});

export interface RetirementAccountDto {
  id: string;
  accountNumber: string;
  riskProfile: string;
  balanceKobo: number;
  totalContributedKobo: number;
  totalGrowthKobo: number;
  /** Growth as a percentage of contributions — the number users actually read. */
  growthPct: number;
  targetAmountKobo: number | null;
  targetDate: string | null;
  targetProgressPct: number | null;
  autoDebit: { enabled: boolean; amountKobo: number | null; dayOfMonth: number | null };
  holdings: Array<{
    assetClass: string;
    instrument: string;
    currentValueKobo: number;
    allocationPct: number;
  }>;
  /** Monthly series for the chart; already bucketed server-side. */
  monthlySeries: Array<{ month: string; contributedKobo: number; balanceKobo: number; growthKobo: number }>;
}

export interface PensionAccountDto {
  id: string;
  pfa: { id: string; name: string; logoUrl: string | null };
  /** Masked RSA number. The full value is never sent to a browser. */
  rsaNumberMasked: string;
  employerName: string | null;
  currentBalanceKobo: number;
  totalContributionsKobo: number;
  employeeContributionsKobo: number;
  employerContributionsKobo: number;
  totalReturnsKobo: number;
  estimatedBenefitKobo: number | null;
  retirementAge: number;
  yearsToRetirement: number | null;
  lastSyncedAt: string | null;
  statements: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    closingBalanceKobo: number;
    hasDocument: boolean;
  }>;
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface NotificationDto {
  id: string;
  category: string;
  title: string;
  body: string;
  actionUrl: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

// ── Dashboard ───────────────────────────────────────────────────────────────

/**
 * The dashboard is a single aggregate endpoint rather than six parallel calls.
 * On a 3G connection in Nigeria, request count dominates payload size — one
 * 40KB response beats six 6KB ones every time.
 */
export interface DashboardDto {
  user: { firstName: string; kycTier: string; profileCompletion: number };
  wallet: { balanceKobo: number; currency: string; isFrozen: boolean };
  verification: {
    email: boolean;
    phone: boolean;
    bvn: boolean;
    twoFactor: boolean;
    /** 0-100, drives the progress ring. */
    score: number;
    nextAction: { label: string; href: string } | null;
  };
  health: { subscriptionCount: number; activePlanName: string | null; daysUntilRenewal: number | null };
  retirement: { balanceKobo: number; growthPct: number; hasPension: boolean };
  recentActivity: Array<{
    id: string;
    type: string;
    title: string;
    subtitle: string;
    amountKobo: number | null;
    status: string;
    createdAt: string;
  }>;
  unreadNotifications: number;
}

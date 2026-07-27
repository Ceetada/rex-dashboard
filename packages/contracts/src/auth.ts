import { z } from 'zod';

import { email, ngPhone, otpCode, password } from './primitives';

export const signUpSchema = z
  .object({
    firstName: z.string().trim().min(2, 'Enter your first name').max(60),
    lastName: z.string().trim().min(2, 'Enter your last name').max(60),
    email,
    phone: ngPhone,
    password,
    confirmPassword: z.string(),
    // NDPA: consent must be explicit and recorded. An unticked box is a valid
    // answer, so this is a hard requirement rather than a default-true.
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'Accept the terms to continue' }),
    }),
    marketingOptIn: z.boolean().default(false),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type SignUpInput = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().default(false),
  /** Opaque client-generated install id; hashed server-side into a Device. */
  deviceFingerprint: z.string().max(256).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export const requestOtpSchema = z.object({
  purpose: z.enum([
    'PHONE_VERIFICATION',
    'EMAIL_VERIFICATION',
    'LOGIN_2FA',
    'PASSWORD_RESET',
    'TRANSACTION_APPROVAL',
    'DEVICE_TRUST',
  ]),
  destination: z.string().optional(),
});

export const verifyOtpSchema = z.object({
  challengeId: z.string().uuid(),
  code: otpCode,
});

export const enable2faSchema = z.object({
  method: z.enum(['TOTP', 'SMS', 'EMAIL']),
});

export const confirm2faSchema = z.object({
  code: otpCode,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/**
 * What the client is allowed to know about itself.
 *
 * Note there is no access token in this payload. The access token is delivered
 * as a __Host- prefixed, HttpOnly, SameSite=Strict cookie so that XSS cannot
 * read it; the body carries only non-secret session metadata. `expiresIn` is
 * present purely so the client can schedule a silent refresh.
 */
export interface AuthSession {
  user: {
    id: string;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    status: string;
    kycTier: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    twoFactorEnabled: boolean;
    roles: string[];
    permissions: string[];
    profileCompletion: number;
  };
  expiresIn: number;
}

/** Login can end in three places, and the client must handle all of them. */
export type LoginResult =
  | { status: 'AUTHENTICATED'; session: AuthSession }
  | { status: 'TWO_FACTOR_REQUIRED'; challengeId: string; method: string; hint: string }
  | { status: 'VERIFICATION_REQUIRED'; challengeId: string; destination: string };

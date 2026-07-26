import { createHash, randomBytes, randomInt } from 'node:crypto';

import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LoginInput, LoginResult, SignUpInput } from '@evas/contracts';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';

import { AuditService } from '../../common/audit/audit.service';
import { TooManyRequestsException } from '../../common/exceptions/too-many-requests.exception';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from './token.service';

export interface RequestContext {
  ip: string;
  userAgent: string;
  deviceFingerprint?: string;
  requestId?: string;
}

/**
 * Authentication.
 *
 * Design notes worth stating up front:
 *
 *  * Passwords use Argon2id, not bcrypt. bcrypt caps at 72 bytes and has no
 *    memory-hardness; Argon2id resists GPU cracking, which is the actual threat
 *    to a leaked Nigerian fintech password database.
 *
 *  * Login does not reveal whether an email exists. Wrong-email and
 *    wrong-password take the same path, do the same work, and return the same
 *    message — otherwise the login form becomes a free user-enumeration oracle.
 *
 *  * Lockout is per-account with exponential backoff, and login attempts are
 *    also rate-limited per IP by the throttler. Account lockout alone lets an
 *    attacker deny service to a known user by failing their login on purpose,
 *    so the window is deliberately short.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxFailedAttempts = 5;
  private readonly otpTtlMs = 10 * 60 * 1000;

  private readonly argonOptions: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19_456, // 19 MiB — OWASP's current floor
    timeCost: 2,
    parallelism: 1,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly encryption: EncryptionService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ── Sign up ───────────────────────────────────────────────────────────────

  async signUp(input: SignUpInput, context: RequestContext) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { phone: input.phone }] },
      select: { id: true, email: true },
    });

    if (existing) {
      // Do not confirm the address is taken. Send a "someone tried to register
      // with your email" notice to the real owner instead, and return the same
      // success shape — the attacker learns nothing, the owner learns
      // something useful.
      await this.notifications
        .send(existing.id, {
          category: 'SECURITY',
          title: 'Sign-up attempt with your email',
          body: 'Someone tried to create an Evas account with your email address. If this was you, sign in instead or reset your password.',
          actionUrl: '/login',
        })
        .catch(() => undefined);

      await this.audit.record({
        actorId: null,
        actorType: 'SYSTEM',
        action: 'auth.signup.duplicate',
        resource: 'User',
        resourceId: existing.id,
        outcome: 'DENIED',
        reason: 'Email or phone already registered',
        ipHash: this.encryption.hashIp(context.ip),
        requestId: context.requestId,
      });

      return { status: 'VERIFICATION_SENT' as const };
    }

    const passwordHash = await argon2.hash(input.password, this.argonOptions);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          passwordHash,
          status: 'PENDING_VERIFICATION',
          profile: { create: { firstName: input.firstName, lastName: input.lastName } },
          wallet: { create: {} },
          notificationPrefs: { create: {} },
        },
      });

      const role = await tx.role.findUnique({ where: { name: 'user' } });
      if (role) await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });

      // NDPA: record exactly what was consented to, and when.
      await tx.consent.createMany({
        data: [
          {
            userId: created.id,
            type: 'TERMS_OF_SERVICE',
            version: this.config.get('POLICY_VERSION', '2026-01-01'),
            granted: true,
            ipHash: this.encryption.hashIp(context.ip),
          },
          {
            userId: created.id,
            type: 'PRIVACY_POLICY',
            version: this.config.get('POLICY_VERSION', '2026-01-01'),
            granted: true,
            ipHash: this.encryption.hashIp(context.ip),
          },
          {
            userId: created.id,
            type: 'MARKETING',
            version: this.config.get('POLICY_VERSION', '2026-01-01'),
            granted: input.marketingOptIn,
            ipHash: this.encryption.hashIp(context.ip),
          },
        ],
      });

      return created;
    });

    await this.sendEmailVerification(user.id, user.email);
    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'auth.signup',
      resource: 'User',
      resourceId: user.id,
      ipHash: this.encryption.hashIp(context.ip),
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    return { status: 'VERIFICATION_SENT' as const };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    // Constant-work path for a non-existent user. Without this dummy verify,
    // the response time difference between "no such user" and "wrong password"
    // is a reliable enumeration oracle.
    if (!user || user.deletedAt) {
      await argon2.hash(input.password, this.argonOptions).catch(() => undefined);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new TooManyRequestsException({
        code: 'ACCOUNT_LOCKED',
        message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      });
    }

    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is not active. Please contact support.',
      });
    }

    const valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);

    if (!valid) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount, context);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Email or password is incorrect',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const device = await this.upsertDevice(user.id, context);

    // An unrecognised device is a step-up trigger even when 2FA is off. Most
    // account takeovers present valid credentials from a new device.
    if (!device.trusted && !user.twoFactorEnabled) {
      const challenge = await this.issueOtp(user.id, user.phone ?? user.email, 'DEVICE_TRUST');
      await this.notifyNewDevice(user.id, device.name, context);
      return {
        status: 'VERIFICATION_REQUIRED',
        challengeId: challenge.id,
        destination: this.maskDestination(user.phone ?? user.email),
      };
    }

    if (user.twoFactorEnabled) {
      const method = user.twoFactorMethod ?? 'TOTP';
      if (method === 'TOTP') {
        // TOTP needs no server-issued challenge; the code comes from the
        // authenticator app. We still create a row to bind the pending login.
        const pending = await this.issueOtp(user.id, 'TOTP', 'LOGIN_2FA', true);
        return {
          status: 'TWO_FACTOR_REQUIRED',
          challengeId: pending.id,
          method,
          hint: 'Enter the 6-digit code from your authenticator app',
        };
      }
      const destination = method === 'SMS' ? user.phone! : user.email;
      const challenge = await this.issueOtp(user.id, destination, 'LOGIN_2FA');
      return {
        status: 'TWO_FACTOR_REQUIRED',
        challengeId: challenge.id,
        method,
        hint: `We sent a code to ${this.maskDestination(destination)}`,
      };
    }

    return {
      status: 'AUTHENTICATED',
      session: await this.establishSession(user.id, device.id, input.rememberMe, context),
    };
  }

  /**
   * Backoff doubles per failure past the threshold, capped at 30 minutes.
   * Long enough to make online guessing hopeless, short enough that a targeted
   * lockout is an annoyance rather than a denial of service.
   */
  private async registerFailedAttempt(
    userId: string,
    currentCount: number,
    context: RequestContext,
  ): Promise<void> {
    const failed = currentCount + 1;
    const overage = failed - this.maxFailedAttempts;
    const lockMinutes = overage > 0 ? Math.min(30, 2 ** (overage - 1)) : 0;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: failed,
        ...(lockMinutes ? { lockedUntil: new Date(Date.now() + lockMinutes * 60_000) } : {}),
      },
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'auth.login.failed',
      resource: 'User',
      resourceId: userId,
      outcome: 'FAILURE',
      reason: `Failed attempt ${failed}`,
      ipHash: this.encryption.hashIp(context.ip),
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    if (failed === this.maxFailedAttempts) {
      await this.notifications
        .send(userId, {
          category: 'SECURITY',
          title: 'Repeated failed sign-in attempts',
          body: 'There have been several failed attempts to sign in to your account. If this was not you, change your password.',
          actionUrl: '/settings/security',
        })
        .catch(() => undefined);
    }
  }

  // ── Session establishment ─────────────────────────────────────────────────

  async establishSession(
    userId: string,
    deviceId: string,
    rememberMe: boolean,
    context: RequestContext,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        profile: true,
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const session = await this.prisma.session.create({
      data: {
        userId,
        deviceId,
        rememberMe,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });

    const roles = user.roles.map((r) => r.role.name);
    const permissions = [
      ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ];

    const accessToken = await this.tokens.issueAccessToken({
      sub: userId,
      sid: session.id,
      roles,
      perms: permissions,
      tier: user.kycTier,
    });
    const refreshToken = await this.tokens.issueRefreshToken(userId, session.id, rememberMe);

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'auth.login.success',
      resource: 'Session',
      resourceId: session.id,
      ipHash: this.encryption.hashIp(context.ip),
      userAgent: context.userAgent,
      requestId: context.requestId,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        firstName: user.profile?.firstName ?? '',
        lastName: user.profile?.lastName ?? '',
        avatarUrl: user.profile?.avatarUrl ?? null,
        status: user.status,
        kycTier: user.kycTier,
        emailVerified: Boolean(user.emailVerifiedAt),
        phoneVerified: Boolean(user.phoneVerifiedAt),
        twoFactorEnabled: user.twoFactorEnabled,
        roles,
        permissions,
        profileCompletion: this.profileCompletion(user),
      },
    };
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  /**
   * OTPs are 6 digits from a CSPRNG (randomInt, not Math.random), stored only
   * as a hash, single-use and attempt-limited. Six digits is a small space, so
   * the attempt cap is what actually provides the security — not the code length.
   */
  async issueOtp(userId: string, destination: string, purpose: string, totpOnly = false) {
    // Invalidate any earlier live challenge for the same purpose so an attacker
    // cannot keep several valid codes in flight at once.
    await this.prisma.otpChallenge.updateMany({
      where: { userId, purpose: purpose as never, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = totpOnly ? '' : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        userId,
        destination,
        purpose: purpose as never,
        codeHash: totpOnly ? 'TOTP' : createHash('sha256').update(code).digest('hex'),
        expiresAt: new Date(Date.now() + this.otpTtlMs),
      },
    });

    if (!totpOnly) {
      await this.notifications.send(userId, {
        category: 'SECURITY',
        title: 'Your Evas verification code',
        body: `Your code is ${code}. It expires in 10 minutes. Never share it with anyone — Evas will never ask you for it.`,
        channels: destination.includes('@') ? ['EMAIL'] : ['SMS'],
      });
    }

    return challenge;
  }

  async verifyOtp(challengeId: string, code: string, context: RequestContext) {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
      include: { user: true },
    });

    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date()) {
      throw new BadRequestException({
        code: 'INVALID_CHALLENGE',
        message: 'That code has expired. Request a new one.',
      });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { consumedAt: new Date() },
      });
      throw new TooManyRequestsException({
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many incorrect codes. Request a new one.',
      });
    }

    let valid: boolean;
    if (challenge.codeHash === 'TOTP') {
      const secret = challenge.user?.twoFactorSecretEncrypted;
      if (!secret) throw new BadRequestException({ code: 'NO_TOTP', message: '2FA is not set up' });
      // otplib's window of 1 tolerates the clock skew that is genuinely common
      // on cheap Android handsets, without meaningfully widening the attack.
      authenticator.options = { window: 1 };
      valid = authenticator.verify({ token: code, secret: this.encryption.decrypt(secret) });
    } else {
      valid = this.encryption.safeEquals(
        challenge.codeHash,
        createHash('sha256').update(code).digest('hex'),
      );
    }

    if (!valid) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException({
        code: 'INVALID_CODE',
        message: 'That code is not correct',
        attemptsRemaining: challenge.maxAttempts - challenge.attempts - 1,
      });
    }

    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });

    return this.applyOtpEffect(challenge, context);
  }

  /** What a verified OTP actually does depends on why it was issued. */
  private async applyOtpEffect(
    challenge: { id: string; userId: string | null; purpose: string; destination: string },
    context: RequestContext,
  ) {
    const userId = challenge.userId!;

    switch (challenge.purpose) {
      case 'PHONE_VERIFICATION': {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            phoneVerifiedAt: new Date(),
            // Verifying a phone lifts the account out of Tier 0, which is what
            // unlocks transacting at all.
            kycTier: 'TIER_1',
            status: 'ACTIVE',
          },
        });
        return { status: 'PHONE_VERIFIED' as const };
      }
      case 'LOGIN_2FA':
      case 'DEVICE_TRUST': {
        const device = await this.upsertDevice(userId, context);
        await this.prisma.device.update({
          where: { id: device.id },
          data: { trusted: true, trustedAt: new Date() },
        });
        return {
          status: 'AUTHENTICATED' as const,
          session: await this.establishSession(userId, device.id, true, context),
        };
      }
      default:
        return { status: 'VERIFIED' as const };
    }
  }

  // ── Devices ───────────────────────────────────────────────────────────────

  private async upsertDevice(userId: string, context: RequestContext) {
    // Fingerprints are hashed: an unhashed device id in the database is another
    // cross-account correlation handle we do not need to hold.
    const fingerprint = createHash('sha256')
      .update(context.deviceFingerprint ?? context.userAgent)
      .digest('hex');

    const name = this.describeDevice(context.userAgent);

    return this.prisma.device.upsert({
      where: { userId_fingerprint: { userId, fingerprint } },
      create: {
        userId,
        fingerprint,
        name,
        lastIpHash: this.encryption.hashIp(context.ip),
        lastSeenAt: new Date(),
      },
      update: {
        lastSeenAt: new Date(),
        lastIpHash: this.encryption.hashIp(context.ip),
      },
    });
  }

  private describeDevice(userAgent: string): string {
    const browser = /Edg/.test(userAgent) ? 'Edge'
      : /Chrome/.test(userAgent) ? 'Chrome'
      : /Safari/.test(userAgent) ? 'Safari'
      : /Firefox/.test(userAgent) ? 'Firefox'
      : 'Browser';
    const platform = /Android/.test(userAgent) ? 'Android'
      : /iPhone|iPad/.test(userAgent) ? 'iOS'
      : /Windows/.test(userAgent) ? 'Windows'
      : /Mac OS/.test(userAgent) ? 'macOS'
      : /Linux/.test(userAgent) ? 'Linux'
      : 'Unknown device';
    return `${browser} on ${platform}`;
  }

  private async notifyNewDevice(userId: string, deviceName: string, context: RequestContext) {
    await this.notifications
      .send(userId, {
        category: 'SECURITY',
        title: 'New sign-in to your account',
        body: `We noticed a sign-in from ${deviceName}. If this was not you, secure your account now.`,
        actionUrl: '/settings/devices',
      })
      .catch(() => undefined);
  }

  async listDevices(userId: string) {
    const devices = await this.prisma.device.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      include: { sessions: { where: { revokedAt: null }, select: { id: true, lastActivityAt: true } } },
    });
    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      trusted: d.trusted,
      lastSeenAt: d.lastSeenAt.toISOString(),
      location: d.lastLocation,
      activeSessions: d.sessions.length,
    }));
  }

  async revokeDevice(userId: string, deviceId: string, context: RequestContext) {
    const device = await this.prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) throw new BadRequestException({ code: 'NOT_FOUND', message: 'Device not found' });

    const sessions = await this.prisma.session.findMany({
      where: { deviceId, revokedAt: null },
      select: { id: true },
    });
    for (const session of sessions) {
      await this.tokens.revokeSessionChain(session.id, 'DEVICE_REVOKED_BY_USER');
    }
    await this.prisma.device.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'auth.device.revoke',
      resource: 'Device',
      resourceId: deviceId,
      ipHash: this.encryption.hashIp(context.ip),
      requestId: context.requestId,
    });
  }

  // ── Password reset ────────────────────────────────────────────────────────

  async forgotPassword(email: string, context: RequestContext): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always return success to the caller, whether or not the account exists.
    // The controller does not branch on this either.
    if (!user || user.deletedAt) {
      this.logger.log(`Password reset requested for unknown address`);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    await this.prisma.verificationToken.create({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        purpose: 'PASSWORD_RESET',
        identifier: email,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const resetUrl = `${this.config.get('WEB_URL', 'http://localhost:3000')}/reset-password?token=${token}`;
    await this.notifications.send(user.id, {
      category: 'SECURITY',
      title: 'Reset your Evas password',
      body: `Use this link to set a new password: ${resetUrl}. It expires in 30 minutes. If you did not request this, ignore this message — your password has not changed.`,
      channels: ['EMAIL'],
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'auth.password.reset_requested',
      resource: 'User',
      resourceId: user.id,
      ipHash: this.encryption.hashIp(context.ip),
      requestId: context.requestId,
    });
  }

  async resetPassword(token: string, newPassword: string, context: RequestContext): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const record = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });

    if (!record || record.consumedAt || record.expiresAt < new Date() || record.purpose !== 'PASSWORD_RESET') {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'That reset link is invalid or has expired',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email: record.identifier } });
    if (!user) throw new BadRequestException({ code: 'INVALID_TOKEN', message: 'Invalid reset link' });

    const passwordHash = await argon2.hash(newPassword, this.argonOptions);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
    ]);

    // A password reset must end every existing session. If the reset was
    // triggered by a compromise, leaving the attacker's session alive defeats
    // the entire exercise.
    await this.tokens.revokeAllSessions(user.id, 'PASSWORD_RESET');

    await this.notifications.send(user.id, {
      category: 'SECURITY',
      title: 'Your password was changed',
      body: 'Your Evas password has just been changed and you have been signed out everywhere. If this was not you, contact support immediately.',
    });

    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'auth.password.reset_completed',
      resource: 'User',
      resourceId: user.id,
      ipHash: this.encryption.hashIp(context.ip),
      requestId: context.requestId,
    });
  }

  // ── Two-factor ────────────────────────────────────────────────────────────

  async beginTotpEnrolment(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = authenticator.generateSecret();

    // Stored encrypted and not yet enabled — 2FA only switches on once the user
    // proves they can generate a valid code, so a mis-scanned QR cannot lock
    // them out of their own account.
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecretEncrypted: this.encryption.encrypt(secret), twoFactorMethod: 'TOTP' },
    });

    return {
      secret,
      otpauthUrl: authenticator.keyuri(user.email, 'Evas', secret),
    };
  }

  async confirmTotpEnrolment(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorSecretEncrypted) {
      throw new BadRequestException({ code: 'NO_ENROLMENT', message: 'Start 2FA setup first' });
    }

    authenticator.options = { window: 1 };
    const valid = authenticator.verify({
      token: code,
      secret: this.encryption.decrypt(user.twoFactorSecretEncrypted),
    });
    if (!valid) {
      throw new BadRequestException({ code: 'INVALID_CODE', message: 'That code is not correct' });
    }

    // Recovery codes are the difference between "lost my phone" and "lost my
    // account". Generated once, shown once, stored only as hashes.
    const plainCodes = Array.from({ length: 10 }, () =>
      randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-'),
    );

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({
        data: plainCodes.map((code) => ({
          userId,
          codeHash: createHash('sha256').update(code).digest('hex'),
        })),
      }),
    ]);

    await this.notifications.send(userId, {
      category: 'SECURITY',
      title: 'Two-factor authentication enabled',
      body: 'Two-factor authentication is now on for your Evas account.',
    });

    return { recoveryCodes: plainCodes };
  }

  // ── Refresh & logout ──────────────────────────────────────────────────────

  async refresh(presentedToken: string, context: RequestContext) {
    const rotated = await this.tokens.rotate(presentedToken);
    if (!rotated) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Please sign in again' });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: rotated.userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    const roles = user.roles.map((r) => r.role.name);
    const permissions = [
      ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ];

    const accessToken = await this.tokens.issueAccessToken({
      sub: user.id,
      sid: rotated.sessionId,
      roles,
      perms: permissions,
      tier: user.kycTier,
    });

    return { accessToken, refreshToken: rotated.refreshToken, expiresIn: 15 * 60 };
  }

  async logout(sessionId: string, userId: string, context: RequestContext): Promise<void> {
    await this.tokens.revokeSessionChain(sessionId, 'USER_LOGOUT');
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'auth.logout',
      resource: 'Session',
      resourceId: sessionId,
      ipHash: this.encryption.hashIp(context.ip),
      requestId: context.requestId,
    });
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.tokens.revokeAllSessions(userId, 'USER_LOGOUT_ALL');
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async sendEmailVerification(userId: string, email: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.verificationToken.create({
      data: {
        tokenHash: createHash('sha256').update(token).digest('hex'),
        purpose: 'EMAIL_VERIFICATION',
        identifier: email,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const url = `${this.config.get('WEB_URL', 'http://localhost:3000')}/verify-email?token=${token}`;
    await this.notifications.send(userId, {
      category: 'SECURITY',
      title: 'Confirm your email address',
      body: `Welcome to Evas. Confirm your email to activate your account: ${url}`,
      channels: ['EMAIL'],
    });
  }

  private maskDestination(destination: string): string {
    if (destination.includes('@')) {
      const [local, domain] = destination.split('@');
      return `${local!.slice(0, 2)}${'•'.repeat(Math.max(1, local!.length - 2))}@${domain}`;
    }
    return `${destination.slice(0, 7)}•••${destination.slice(-2)}`;
  }

  /**
   * Drives the "complete your profile" ring on the dashboard. Weighted by what
   * actually unlocks functionality rather than by field count — verifying a
   * phone matters far more than filling in a middle name.
   */
  private profileCompletion(user: {
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    twoFactorEnabled: boolean;
    profile: { dateOfBirth: Date | null; stateCode: string | null; addressLine1: string | null; avatarUrl: string | null; bvnEncrypted: string | null } | null;
  }): number {
    const checks: Array<[boolean, number]> = [
      [Boolean(user.emailVerifiedAt), 20],
      [Boolean(user.phoneVerifiedAt), 25],
      [Boolean(user.profile?.bvnEncrypted), 20],
      [Boolean(user.profile?.dateOfBirth), 10],
      [Boolean(user.profile?.addressLine1 && user.profile?.stateCode), 10],
      [user.twoFactorEnabled, 10],
      [Boolean(user.profile?.avatarUrl), 5],
    ];
    return checks.reduce((total, [done, weight]) => total + (done ? weight : 0), 0);
  }
}

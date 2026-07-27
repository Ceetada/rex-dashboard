import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface AccessTokenPayload {
  sub: string;
  sid: string; // session id — lets us revoke a single device
  roles: string[];
  perms: string[];
  tier: string;
  /** Issued-at, compared against User.tokensValidFrom for instant global revocation. */
  iat?: number;
  exp?: number;
}

/**
 * JWT issuance, rotation and reuse detection.
 *
 * The design choices worth stating:
 *
 *  * Access tokens are short (15 min) and carry authorisation claims so the hot
 *    path needs no database read. Refresh tokens are long (30d with "remember
 *    me", 12h without) and are *always* checked against the database.
 *
 *  * Refresh tokens rotate on every use. The old token is marked used and
 *    linked to its replacement, forming a chain.
 *
 *  * If an already-used refresh token is presented again, it has been stolen
 *    and replayed — either the attacker or the legitimate user is using a copy.
 *    We cannot tell which, so we revoke the entire chain and force both to
 *    re-authenticate. Failing closed is the only safe answer here.
 *
 *  * Only the SHA-256 hash of a refresh token is stored. A database dump must
 *    not hand out working sessions.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly accessTtl: string;
  private readonly refreshTtlMs: number;
  private readonly rememberMeTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshTtlMs = this.config.get<number>('JWT_REFRESH_TTL_MS', 12 * 60 * 60 * 1000);
    this.rememberMeTtlMs = this.config.get<number>('JWT_REMEMBER_TTL_MS', 30 * 24 * 60 * 60 * 1000);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issueAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): Promise<string> {
    return this.jwt.signAsync(payload, {
      expiresIn: this.accessTtl,
      issuer: 'evas.ng',
      audience: 'evas-web',
      // A random jti makes each token individually identifiable in the audit log.
      jwtid: randomUUID(),
    });
  }

  async issueRefreshToken(userId: string, sessionId: string, rememberMe: boolean): Promise<string> {
    // 256 bits of entropy — a refresh token is a bearer credential, not a JWT.
    // There is nothing to read inside it, so there is no reason to make it one.
    const token = randomBytes(32).toString('base64url');
    const ttl = rememberMe ? this.rememberMeTtlMs : this.refreshTtlMs;

    await this.prisma.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    return token;
  }

  /**
   * Exchanges a refresh token for a new pair. Returns null when the token is
   * simply unknown or expired; throws when reuse is detected, because that is a
   * security event the caller must surface rather than treat as a normal
   * "please log in again".
   */
  async rotate(
    presented: string,
  ): Promise<{ userId: string; sessionId: string; refreshToken: string } | null> {
    const tokenHash = this.hash(presented);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!existing) return null;

    if (existing.usedAt || existing.revokedAt) {
      // Replay. Burn the whole chain for this session — we do not know which
      // party is the attacker, so neither gets to keep the session.
      await this.revokeSessionChain(existing.sessionId, 'REFRESH_TOKEN_REUSE_DETECTED');
      this.logger.error(
        `Refresh token reuse detected for user ${existing.userId}, session ${existing.sessionId}. Chain revoked.`,
      );
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Your session ended for security reasons. Please sign in again.',
      });
    }

    if (existing.expiresAt < new Date()) return null;
    if (existing.session.revokedAt) return null;
    if (existing.session.expiresAt < new Date()) return null;

    const replacement = randomBytes(32).toString('base64url');
    const ttl = existing.session.rememberMe ? this.rememberMeTtlMs : this.refreshTtlMs;

    // Rotation must be atomic: if we mint the new token but fail to burn the
    // old one, both are briefly valid and reuse detection silently breaks.
    await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          sessionId: existing.sessionId,
          tokenHash: this.hash(replacement),
          expiresAt: new Date(Date.now() + ttl),
        },
      });
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { usedAt: new Date(), replacedById: created.id },
      });
      await tx.session.update({
        where: { id: existing.sessionId },
        data: { lastActivityAt: new Date() },
      });
    });

    return {
      userId: existing.userId,
      sessionId: existing.sessionId,
      refreshToken: replacement,
    };
  }

  async revokeSessionChain(sessionId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: now, revokedReason: reason },
      }),
    ]);
  }

  /** "Log out everywhere". Also invoked on password change and on breach response. */
  async revokeAllSessions(userId: string, reason: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: reason },
      }),
      // Bumping this instantly invalidates every already-issued access token,
      // without waiting out their 15-minute TTL.
      this.prisma.user.update({
        where: { id: userId },
        data: { tokensValidFrom: now },
      }),
    ]);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        issuer: 'evas.ng',
        audience: 'evas-web',
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Session expired' });
    }
  }
}

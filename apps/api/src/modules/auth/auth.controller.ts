import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  confirm2faSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  verifyOtpSchema,
  type LoginResult,
} from '@evas/contracts';
import type { CookieOptions, Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { AccessTokenPayload } from './token.service';
import { AuthService, type RequestContext } from './auth.service';

/**
 * Cookie strategy.
 *
 * Tokens live in cookies, not localStorage. localStorage is readable by any
 * script on the page, so a single XSS — in our code or in a dependency — hands
 * over the session. HttpOnly cookies are not.
 *
 * The `__Host-` prefix is doing real work: the browser refuses to accept such a
 * cookie unless it is Secure, has no Domain attribute and is Path=/. That makes
 * it impossible for a compromised subdomain to write a cookie our app will
 * trust — a subdomain-takeover defence that costs nothing.
 *
 * SameSite=Strict on the access cookie means it is simply not sent on
 * cross-site requests, which removes CSRF for state-changing calls outright.
 */
const secureCookie = (maxAgeMs: number): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  maxAge: maxAgeMs,
});

const ACCESS_COOKIE = '__Host-evas_access';
const REFRESH_COOKIE = '__Host-evas_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private context(request: Request): RequestContext {
    return {
      // trust proxy is enabled, so req.ip already reflects X-Forwarded-For.
      ip: request.ip ?? 'unknown',
      userAgent: request.headers['user-agent'] ?? 'unknown',
      deviceFingerprint: request.headers['x-device-id'] as string | undefined,
      requestId: (request as Request & { requestId?: string }).requestId,
    };
  }

  private setSessionCookies(
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
    rememberMe: boolean,
  ): void {
    response.cookie(ACCESS_COOKIE, tokens.accessToken, secureCookie(15 * 60 * 1000));
    response.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      secureCookie(rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000),
    );
  }

  @Public()
  @Post('signup')
  // Sign-up is expensive (Argon2) and a natural target for abuse.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signUp(@ZodBody(signUpSchema) body: unknown, @Req() request: Request) {
    return this.auth.signUp(body as never, this.context(request));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @ZodBody(loginSchema) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const result = await this.auth.login(body as never, this.context(request));

    if (result.status === 'AUTHENTICATED') {
      const session = result.session as unknown as {
        accessToken: string;
        refreshToken: string;
        user: unknown;
        expiresIn: number;
      };
      this.setSessionCookies(response, session, (body as { rememberMe?: boolean }).rememberMe ?? false);
      // Strip the tokens from the body — they are in cookies, and echoing them
      // in JSON would put them back within reach of any script on the page.
      return {
        status: 'AUTHENTICATED',
        session: { user: session.user, expiresIn: session.expiresIn } as never,
      };
    }

    return result;
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyOtp(
    @ZodBody(verifyOtpSchema) body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { challengeId, code } = body as { challengeId: string; code: string };
    const result = await this.auth.verifyOtp(challengeId, code, this.context(request));

    if (result.status === 'AUTHENTICATED' && 'session' in result) {
      const session = result.session as unknown as {
        accessToken: string;
        refreshToken: string;
        user: unknown;
        expiresIn: number;
      };
      this.setSessionCookies(response, session, true);
      return {
        status: 'AUTHENTICATED',
        session: { user: session.user, expiresIn: session.expiresIn },
      };
    }
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const presented = (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (!presented) {
      throw new UnauthorizedException({ code: 'NO_REFRESH_TOKEN', message: 'Please sign in again' });
    }

    const result = await this.auth.refresh(presented, this.context(request));
    this.setSessionCookies(response, result, true);
    return { expiresIn: result.expiresIn };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  async forgotPassword(@ZodBody(forgotPasswordSchema) body: unknown, @Req() request: Request) {
    await this.auth.forgotPassword((body as { email: string }).email, this.context(request));
    // Always 202 with the same body, whether or not the account exists.
    return { message: 'If that email is registered, we have sent a reset link.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  async resetPassword(@ZodBody(resetPasswordSchema) body: unknown, @Req() request: Request) {
    const { token, password } = body as { token: string; password: string };
    await this.auth.resetPassword(token, password, this.context(request));
    return { message: 'Your password has been changed. Please sign in.' };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: AccessTokenPayload,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(user.sid, user.sub, this.context(request));
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Signed out' };
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutEverywhere(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logoutEverywhere(userId);
    response.clearCookie(ACCESS_COOKIE, { path: '/' });
    response.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Signed out on all devices' };
  }

  @Post('2fa/setup')
  async beginTwoFactor(@CurrentUser('sub') userId: string) {
    return this.auth.beginTotpEnrolment(userId);
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  async confirmTwoFactor(@CurrentUser('sub') userId: string, @ZodBody(confirm2faSchema) body: unknown) {
    return this.auth.confirmTotpEnrolment(userId, (body as { code: string }).code);
  }

  @Get('devices')
  async devices(@CurrentUser('sub') userId: string) {
    return this.auth.listDevices(userId);
  }

  @Delete('devices/:id')
  @HttpCode(200)
  async revokeDevice(
    @CurrentUser('sub') userId: string,
    @Param('id') deviceId: string,
    @Req() request: Request,
  ) {
    await this.auth.revokeDevice(userId, deviceId, this.context(request));
    return { message: 'Device signed out' };
  }
}

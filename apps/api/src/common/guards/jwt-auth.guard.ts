import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';
import { TokenService, type AccessTokenPayload } from '../../modules/auth/token.service';
import { IS_PUBLIC } from '../decorators/public.decorator';

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
  requestId: string;
}

/**
 * Authenticates every request unless the handler is explicitly @Public().
 *
 * Deny-by-default is the important property here: a new controller is protected
 * the moment it is written. The alternative — opt-in guards — means the one
 * endpoint someone forgets to annotate is the one that leaks.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Authentication required' });
    }

    const payload = await this.tokens.verifyAccessToken(token);

    // The claims inside a JWT are a 15-minute-old snapshot. Two things can
    // change inside that window and must be checked against live state:
    // a suspended account, and a "log out everywhere" that predates this token.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { status: true, tokensValidFrom: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException({ code: 'ACCOUNT_NOT_FOUND', message: 'Account unavailable' });
    }
    if (user.status === 'SUSPENDED' || user.status === 'CLOSED') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account is suspended. Contact support.',
      });
    }
    // iat is in seconds; tokensValidFrom in ms. A token issued before the cutoff
    // is one we have deliberately invalidated.
    if (payload.iat && payload.iat * 1000 < user.tokensValidFrom.getTime()) {
      throw new UnauthorizedException({
        code: 'TOKEN_REVOKED',
        message: 'Your session ended. Please sign in again.',
      });
    }

    request.user = payload;
    return true;
  }

  private extractToken(request: Request): string | null {
    // Cookie first: this is how the browser client authenticates, and the cookie
    // is HttpOnly so XSS cannot read it.
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[
      '__Host-evas_access'
    ];
    if (cookieToken) return cookieToken;

    // Bearer header is retained for native/mobile clients and server-to-server.
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);

    return null;
  }
}

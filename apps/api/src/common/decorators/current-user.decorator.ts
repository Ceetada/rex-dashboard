import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../../modules/auth/token.service';

/** Injects the verified JWT payload. Never trust a user id from the body or params. */
export const CurrentUser = createParamDecorator(
  (field: keyof AccessTokenPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return field ? request.user?.[field] : request.user;
  },
);

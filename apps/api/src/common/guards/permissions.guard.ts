import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuditService } from '../audit/audit.service';
import { REQUIRED_PERMISSIONS } from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from './jwt-auth.guard';

/**
 * RBAC enforcement.
 *
 * Permissions are carried in the access token, so authorisation costs nothing
 * on the hot path. That is safe because the token lives 15 minutes and any
 * role change bumps `tokensValidFrom`, which JwtAuthGuard checks — so a revoked
 * admin loses access immediately rather than at token expiry.
 *
 * A wildcard (`user:*` or `*`) grants everything beneath it, which keeps
 * super-admin from needing a row per permission.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = request.user?.perms ?? [];

    const allowed = required.every((permission) => this.satisfies(granted, permission));

    if (!allowed) {
      // A denied privileged action is exactly the kind of event an auditor asks
      // about, so failures are logged as deliberately as successes.
      await this.audit.record({
        actorId: request.user?.sub ?? null,
        actorType: 'USER',
        action: 'authorization.denied',
        resource: context.getClass().name,
        resourceId: context.getHandler().name,
        outcome: 'DENIED',
        reason: `Missing permission(s): ${required.join(', ')}`,
        requestId: request.requestId,
      });
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'You do not have access to this action',
      });
    }

    return true;
  }

  private satisfies(granted: string[], required: string[] | string): boolean {
    const needed = Array.isArray(required) ? required[0]! : required;
    if (granted.includes('*')) return true;
    if (granted.includes(needed)) return true;

    const [resource] = needed.split(':');
    return granted.includes(`${resource}:*`);
  }
}

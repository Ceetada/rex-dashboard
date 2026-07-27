import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/**
 * Guards check permissions, never role names.
 *
 * `@RequirePermissions('user:suspend')` keeps working when "support" is split
 * into "support_tier_1" and "support_tier_2"; `@Roles('support')` does not.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { notificationPreferencesSchema, updateProfileSchema } from '@evas/contracts';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.users.getProfile(userId);
  }

  /**
   * One aggregate call rather than six parallel ones. On a Nigerian 3G
   * connection round-trip count dominates payload size, so the dashboard is
   * assembled server-side.
   */
  @Get('me/dashboard')
  dashboard(@CurrentUser('sub') userId: string) {
    return this.users.getDashboard(userId);
  }

  @Patch('me')
  updateProfile(@CurrentUser('sub') userId: string, @ZodBody(updateProfileSchema) body: unknown) {
    return this.users.updateProfile(userId, body as never);
  }

  @Put('me/notification-preferences')
  updatePreferences(
    @CurrentUser('sub') userId: string,
    @ZodBody(notificationPreferencesSchema) body: unknown,
  ) {
    return this.users.updateNotificationPreferences(userId, body as never);
  }

  @Get('states')
  states() {
    return this.users.listStates();
  }
}

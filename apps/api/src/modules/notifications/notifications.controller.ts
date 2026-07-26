import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser('sub') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.list(userId, {
      cursor,
      limit: Math.min(Number(limit) || 20, 100),
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('sub') userId: string) {
    return this.notifications.unreadCount(userId).then((count) => ({ count }));
  }

  @Patch('read')
  markRead(@CurrentUser('sub') userId: string, @Body('ids') ids: string[]) {
    return this.notifications.markRead(userId, ids ?? []).then((count) => ({ count }));
  }

  @Post('read-all')
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.notifications.markAllRead(userId).then((count) => ({ count }));
  }
}

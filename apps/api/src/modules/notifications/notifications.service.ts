import { Injectable, Logger } from '@nestjs/common';
import type { NotificationCategory, NotificationChannel } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ProviderRegistry } from '../providers/provider.registry';
import type { MessagingAdapter } from '../providers/provider.types';

export interface SendNotificationInput {
  category: NotificationCategory;
  title: string;
  body: string;
  actionUrl?: string;
  data?: Record<string, unknown>;
  /** Defaults to the user's preferences; pass to force a specific set. */
  channels?: NotificationChannel[];
}

/**
 * Multi-channel notification fan-out.
 *
 * The in-app record is always written — it is the user's history, and it is
 * what the bell icon reads. External channels (email, SMS, push) are then
 * attempted according to the user's preferences, each tracked as its own
 * NotificationDelivery row so one failing channel does not obscure the others.
 *
 * Two rules are enforced here rather than left to callers:
 *
 *  * SECURITY notifications ignore preferences and quiet hours entirely. A user
 *    must not be able to mute "your password was changed" — that is precisely
 *    the message an attacker would want suppressed.
 *
 *  * A suppressed message is recorded as SUPPRESSED rather than dropped, so
 *    "why didn't I get an SMS?" is answerable from data six weeks later.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
  ) {}

  async send(userId: string, input: SendNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        category: input.category,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl ?? null,
        data: (input.data ?? {}) as never,
      },
    });

    const channels = input.channels ?? (await this.resolveChannels(userId, input.category));

    // Fan out without blocking the caller. A slow SMS gateway must not add a
    // second of latency to a purchase response.
    void Promise.allSettled(
      channels.map((channel) => this.deliver(notification.id, userId, channel, input)),
    );

    return notification;
  }

  private async resolveChannels(
    userId: string,
    category: NotificationCategory,
  ): Promise<NotificationChannel[]> {
    // Security messages bypass every preference, including quiet hours.
    if (category === 'SECURITY') return ['IN_APP', 'EMAIL', 'SMS'];

    const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) return ['IN_APP', 'EMAIL'];

    const overrides =
      (prefs.categoryOverrides as Record<string, Record<string, boolean>> | null)?.[category] ?? {};

    const enabled: NotificationChannel[] = [];
    if (overrides.inApp ?? prefs.inAppEnabled) enabled.push('IN_APP');
    if (overrides.email ?? prefs.emailEnabled) enabled.push('EMAIL');
    if (overrides.sms ?? prefs.smsEnabled) enabled.push('SMS');
    if (overrides.push ?? prefs.pushEnabled) enabled.push('PUSH');

    if (this.inQuietHours(prefs.quietHoursStart, prefs.quietHoursEnd, prefs.timezone)) {
      // Keep the in-app record so it is waiting when they wake up; hold the
      // channels that would buzz a phone at 3am.
      return enabled.filter((c) => c === 'IN_APP');
    }
    return enabled;
  }

  private inQuietHours(start: string | null, end: string | null, timezone: string): boolean {
    if (!start || !end) return false;
    const now = new Date().toLocaleTimeString('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    // Windows that cross midnight (22:00-07:00) need the inverted comparison.
    return start <= end ? now >= start && now < end : now >= start || now < end;
  }

  private async deliver(
    notificationId: string,
    userId: string,
    channel: NotificationChannel,
    input: SendNotificationInput,
  ): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.create({
      data: { notificationId, channel, status: 'QUEUED' },
    });

    // IN_APP is already delivered by virtue of the Notification row existing.
    if (channel === 'IN_APP') {
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', deliveredAt: new Date(), sentAt: new Date() },
      });
      return;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
      });
      if (!user) throw new Error('User not found');

      // Never send to an unverified destination: it may belong to someone else,
      // and sending transaction details there is a data breach.
      if (channel === 'EMAIL' && !user.emailVerifiedAt) {
        return this.suppress(delivery.id, 'Email not verified');
      }
      if (channel === 'SMS' && (!user.phone || !user.phoneVerifiedAt)) {
        return this.suppress(delivery.id, 'Phone not verified');
      }

      let messageId = 'noop';
      if (channel === 'EMAIL') {
        const { adapter } = await this.registry.resolve<MessagingAdapter>('MESSAGING', 'email-default');
        const result = await adapter.sendEmail?.({
          to: user.email,
          subject: input.title,
          text: input.body,
          html: `<p>${escapeHtml(input.body)}</p>`,
        });
        messageId = result?.messageId ?? 'noop';
      } else if (channel === 'SMS') {
        const { adapter } = await this.registry.resolve<MessagingAdapter>('MESSAGING', 'sms-default');
        // SMS costs real money per segment and Nigerian users are charged for
        // nothing — so the body is truncated to one segment deliberately.
        const result = await adapter.sendSms?.({
          to: user.phone!,
          body: `${input.title}: ${input.body}`.slice(0, 160),
        });
        messageId = result?.messageId ?? 'noop';
      } else {
        // PUSH is scaffolded but not yet wired to a provider.
        return this.suppress(delivery.id, 'Push channel not yet enabled');
      }

      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: messageId, attempts: 1 },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Delivery failed';
      this.logger.warn(`${channel} delivery failed for notification ${notificationId}: ${reason}`);
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', failureReason: reason, attempts: 1 },
      });
    }
  }

  private async suppress(deliveryId: string, reason: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'SUPPRESSED', failureReason: reason },
    });
  }

  async list(userId: string, options: { cursor?: string; limit: number; unreadOnly?: boolean }) {
    const notifications = await this.prisma.notification.findMany({
      where: { userId, archivedAt: null, ...(options.unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: options.limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = notifications.length > options.limit;
    const page = hasMore ? notifications.slice(0, options.limit) : notifications;

    return {
      data: page.map((n) => ({
        id: n.id,
        category: n.category,
        title: n.title,
        body: n.body,
        actionUrl: n.actionUrl,
        data: n.data as Record<string, unknown>,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    // Scoped by userId as well as id — never let a client mark someone else's
    // notification as read by guessing a uuid.
    const result = await this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async markAllRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null, archivedAt: null } });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { RedisService } from 'src/redis/redis.service';
import { NotificationsService } from '../background-notification/backgroundnotification.service';

export interface CreateNotificationData {
  recipientIds: string[];
  type: string;
  title: string;
  message: string;
  imageUrl?: string;
  link?: string;
  data?: any;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisPubSub: RedisPubSubService,
    private readonly redisService: RedisService,
    private notificationsService: NotificationsService,
  ) {}

  async createNotification(data: CreateNotificationData) {
    try {
      // Create notifications in database
      const notifications = await Promise.all(
        data.recipientIds.map((recipientId) =>
          this.prisma.notification.create({
            data: {
              recipientId,
              type: data.type,
              title: data.title,
              message: data.message,
              imageUrl: data.imageUrl,
              link: data.link,
              read: false,
            },
          }),
        ),
      );

      // Increment unread counts in Redis for all recipients
      await Promise.all(
        data.recipientIds.map((recipientId) =>
          this.redisService.client.incr(`notification:unread:${recipientId}`),
        ),
      );

      // Publish notifications to all recipients
      await Promise.all(
        notifications.map((notification) =>
          this.redisPubSub.publishNotification({
            recipientId: notification.recipientId,
            notificationType: data.type,
            data: {
              id: notification.id,
              title: notification.title,
              message: notification.message,
              imageUrl: notification.imageUrl ?? undefined,
              link: notification.link,
              createdAt: notification.createdAt,
              read: notification.read,
            },
          }),
        ),
      );

      await this.notificationsService.sendRegularNotification({
        userIds: data.recipientIds,
        title: data.title,
        link: data.link,
        message: data.message,
        type: data.type,
        data: data.data,
      });

      return notifications;
    } catch (error) {
      this.logger.error('Failed to create notification', error.stack);
      throw error;
    }
  }

  async getNotificationsCursor(
    userId: string,
    limit = 20,
    before?: string,
    beforeId?: string,
  ) {
    const cursor =
      before && beforeId
        ? { createdAt: new Date(before), id: beforeId }
        : undefined;

    return this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursor && { cursor, skip: 1 }),
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    // Verify ownership and update database
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, recipientId: userId },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (!notification.read) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { read: true },
      });

      // Decrement Redis count
      const currentCount = await this.redisService.client.get(
        `notification:unread:${userId}`,
      );
      if (currentCount && parseInt(currentCount) > 0) {
        await this.redisService.client.decr(`notification:unread:${userId}`);
      }
    }

    return notification;
  }

  async markAllAsRead(userId: string): Promise<void> {
    // Update database
    await this.prisma.notification.updateMany({
      where: { recipientId: userId, read: false },
      data: { read: true },
    });

    // Reset Redis count
    await this.redisService.client.set(`notification:unread:${userId}`, 0);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const count = await this.redisService.client.get(
      `notification:unread:${userId}`,
    );
    return parseInt(count || '0');
  }

  async getNotificationTray(userId: string) {
    const [notifications, totalUnread] = await Promise.all([
      this.getNotificationsCursor(userId, 10), // Last 10 notifications
      this.getUnreadCount(userId),
    ]);

    return {
      notifications,
      totalUnread,
      hasMore: notifications.length === 10,
    };
  }
}

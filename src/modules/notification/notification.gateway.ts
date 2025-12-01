// notification.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { BaseGateway } from 'src/common/base.gateway';

@WebSocketGateway({ cors: true })
@UseGuards(WsJwtGuard)
export class NotificationGateway extends BaseGateway {
  protected logger: Logger = new Logger('NotificationGateway');

  constructor(
    private readonly notificationService: NotificationService,
    pubsubService: RedisPubSubService,
  ) {
    super(pubsubService);
  }

  protected onUserConnected(client: Socket, userId: string) {
    // Send initial data on connection
    this.notificationService.getNotificationTray(userId).then((tray) => {
      client.emit('notificationTray', tray);
    });
  }

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: string },
  ) {
    const userId = client.handshake.auth.user.sub;
    if (!userId) return;

    try {
      await this.notificationService.markAsRead(userId, data.notificationId);
      const tray = await this.notificationService.getNotificationTray(userId);
      client.emit('notificationTray', tray);
    } catch (error) {
      this.logger.error('Error marking notification as read', error.stack);
      client.emit('error', 'Failed to mark notification as read');
    }
  }

  @SubscribeMessage('markAllAsRead')
  async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
    const userId = client.handshake.auth.user.sub;
    if (!userId) return;

    try {
      await this.notificationService.markAllAsRead(userId);
      const tray = await this.notificationService.getNotificationTray(userId);
      client.emit('notificationTray', tray);
    } catch (error) {
      this.logger.error('Error marking all notifications as read', error.stack);
      client.emit('error', 'Failed to mark all notifications as read');
    }
  }

  @SubscribeMessage('loadMoreNotifications')
  async handleLoadMoreNotifications(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { before?: string; beforeId?: string; limit?: number },
  ) {
    const userId = client.handshake.auth.user.sub;
    if (!userId) return;

    try {
      const notifications =
        await this.notificationService.getNotificationsCursor(
          userId,
          data.limit || 20,
          data.before,
          data.beforeId,
        );

      const hasMore = notifications.length === (data.limit || 20);

      client.emit('notifications', {
        notifications,
        hasMore,
        ...(hasMore &&
          notifications.length > 0 && {
            nextCursor: {
              before:
                notifications[notifications.length - 1].createdAt.toISOString(),
              beforeId: notifications[notifications.length - 1].id,
            },
          }),
      });
    } catch (error) {
      this.logger.error('Error loading more notifications', error.stack);
      client.emit('error', 'Failed to load notifications');
    }
  }

  @SubscribeMessage('getNotificationTray')
  async handleGetNotificationTray(@ConnectedSocket() client: Socket) {
    const userId = client.handshake.auth.user.sub;
    if (!userId) return;

    try {
      const tray = await this.notificationService.getNotificationTray(userId);
      client.emit('notificationTray', tray);
    } catch (error) {
      this.logger.error('Error getting notification tray', error.stack);
      client.emit('error', 'Failed to get notification tray');
    }
  }
}

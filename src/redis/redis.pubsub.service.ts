// redis.pubsub.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import { PubSubMessage, PubSubNotification } from './pubsub.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private io: Server;
  private typingTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly logger = new Logger(RedisPubSubService.name);

  constructor(private readonly prisma: PrismaService) {
    this.publisher = new Redis({
      enableOfflineQueue: false, // Disable queueing when Redis is down
      maxRetriesPerRequest: 1, // Fail fast if Redis is unavailable
    });
    this.subscriber = new Redis({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
  }

  setSocketServer(io: Server) {
    this.io = io;
  }

  async onModuleInit() {
    try {
      await Promise.all([
        this.subscriber.subscribe('chat'),
        this.subscriber.subscribe('typing'),
        this.subscriber.subscribe('notifications'),
        this.subscriber.subscribe('posts'), // 👈 NEW
      ]);

      this.subscriber.on('message', this.messageHandler.bind(this));
      this.logger.log('Redis Pub/Sub initialized and subscribed to channels');
    } catch (error) {
      this.logger.error('Failed to initialize Redis Pub/Sub', error.stack);
      throw error;
    }
  }

  private async messageHandler(channel: string, message: string) {
    try {
      if (!this.io) {
        this.logger.warn('Received message but Socket.IO server not available');
        return;
      }

      const payload = JSON.parse(message);

      if (channel === 'notifications') {
        this.handleNotification(payload as PubSubNotification);
      } else if (channel === 'posts') {
        this.handlePostMessage(payload);
      } else {
        this.handleStandardMessage(payload as PubSubMessage);
      }
    } catch (error) {
      this.logger.error(`Error processing ${channel} message`, {
        message,
        error: error.stack,
      });
    }
  }

  private async handleStandardMessage(payload: PubSubMessage) {
    switch (payload.type) {
      case 'chat':
        await this.handleChatMessage(payload);
        break;
      case 'typing':
        this.handleTypingIndicator(payload);
        break;
      case 'tray_update':
        this.handleTrayUpdate(payload);
        break;
      default:
        this.logger.warn(`Unknown message type: ${(payload as any).type}`);
    }
  }

  private async handleChatMessage(payload: PubSubMessage) {
    const { carpoolId, senderId, message } = payload;

    try {
      // Send message to carpool room
      this.io.to(`carpool:${carpoolId}`).emit('newMessage', message);

      const carpool = await this.prisma.carpool.findUnique({
        where: { id: carpoolId },
        select: {
          driverId: true,
          passengers: {
            where: { status: 'ACCEPTED' },
            select: { userId: true },
          },
        },
      });

      if (!carpool) {
        this.logger.warn(`Carpool ${carpoolId} not found`);
        return;
      }

      const participantIds = [
        carpool.driverId,
        ...carpool.passengers.map((p) => p.userId),
      ].filter((id) => id !== senderId);

      await Promise.all(
        participantIds.map(async (recipientId) => {
          const unreadKey = `message:unread:${recipientId}:${carpoolId}`;
          const newCount = await this.publisher.incr(unreadKey);

          // Update conversation tray
          this.io.to(`user:${recipientId}`).emit('conversationTrayUpdate', {
            carpoolId,
            lastMessage: message,
            unreadCount: newCount,
          });

          const totalUnread = await this.getTotalUnreadCount(recipientId);
          this.io.to(`user:${recipientId}`).emit('unreadCountUpdate', {
            totalUnread,
            carpoolId,
            unreadCount: newCount,
          });
        }),
      );
    } catch (error) {
      this.logger.error(`Error handling chat message`, {
        carpoolId,
        senderId,
        error: error.stack,
      });
    }
  }

  private handleTypingIndicator(payload: PubSubMessage) {
    const { carpoolId, senderId, isTyping } = payload;
    const key = `${senderId}-${carpoolId}`;

    // Clear previous timeout if exists
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      this.typingTimeouts.delete(key);
    }

    if (isTyping) {
      // Broadcast typing start
      this.io
        .to(`carpool:${carpoolId}`)
        .except(`user:${senderId}`)
        .emit('typing', {
          userId: senderId,
          isTyping: true,
        });

      // Set timeout to automatically stop typing
      const timeout = setTimeout(() => {
        this.publish({
          type: 'typing',
          carpoolId,
          senderId,
          isTyping: false,
        });
      }, 5000);

      this.typingTimeouts.set(key, timeout);
    } else {
      // Broadcast typing stopped
      this.io.to(`carpool:${carpoolId}`).emit('typing', {
        userId: senderId,
        isTyping: false,
      });
    }
  }

  private handleTrayUpdate(payload: PubSubMessage) {
    const { recipientId } = payload;
    if (recipientId) {
      this.io.to(`user:${recipientId}`).emit('conversationTrayRefresh');
    }
  }

  private handleNotification(payload: PubSubNotification) {
    const { recipientId } = payload;
    console.log(recipientId);
    if (!recipientId) {
      this.logger.warn('Notification missing recipientId');
      return;
    }

    try {
      this.io.to(`user:${recipientId}`).emit('notifications', payload);
      this.logger.log(`Notification sent to user ${recipientId}`);
    } catch (error) {
      this.logger.error(`Failed to send notification to user ${recipientId}`, {
        error: error.stack,
      });
    }
  }

  private async getTotalUnreadCount(userId: string): Promise<number> {
    try {
      const keys = await this.publisher.keys(`message:unread:${userId}:*`);
      if (!keys.length) return 0;

      const counts = await this.publisher.mget(keys);
      return counts.reduce((acc, c) => acc + Number(c ?? 0), 0);
    } catch (error) {
      this.logger.error(
        `Failed to get unread count for user ${userId}`,
        error.stack,
      );
      return 0;
    }
  }

  private handlePostMessage(payload: {
    type: string;
    post?: any;
    comment?: any;
  }) {
    const { type, post, comment } = payload;

    switch (type) {
      case 'post:new':
      case 'post:pinned':
      case 'post:updated':
      case 'post:deleted': {
        if (!post?.eventId) {
          this.logger.warn(`Post event (${type}) missing eventId`);
          return;
        }
        const room = `event:${post.eventId}`;
        this.io.to(room).emit(type, post); // emits 'post:new', 'post:pinned', etc.
        break;
      }

      case 'comment:new':
      case 'comment:deleted': {
        if (!comment?.postId) {
          this.logger.warn(`Comment event (${type}) missing postId`);
          return;
        }
        const room = `post:${comment.postId}`;
        console.log(room, type);
        this.io.to(room).emit(type, comment); // emits 'comment:new' or 'comment:deleted'
        break;
      }

      default:
        this.logger.warn(`Unknown post-related event type: ${type}`);
    }
  }

  async publish(data: PubSubMessage) {
    try {
      const channel = data.type === 'typing' ? 'typing' : 'chat';
      await this.publisher.publish(channel, JSON.stringify(data));
    } catch (error) {
      this.logger.error('Failed to publish message', {
        data,
        error: error.stack,
      });
    }
  }

  async publishNotification(notification: Omit<PubSubNotification, 'type'>) {
    try {
      const payload: PubSubNotification = {
        type: 'notifications',
        ...notification,
      };
      await this.publisher.publish('notifications', JSON.stringify(payload));
      this.logger.log(
        `Notification published for user ${notification.recipientId}`,
      );
    } catch (error) {
      this.logger.error('Failed to publish notification', {
        notification,
        error: error.stack,
      });
      throw error;
    }
  }

  async publishPost(
    post: any,
    type: 'post:new' | 'post:pinned' | 'post:deleted' | 'post:updated',
  ) {
    try {
      await this.publisher.publish('posts', JSON.stringify({ type, post }));
      this.logger.log(`Published ${type} for post ${post.id}`);
    } catch (error) {
      this.logger.error('Failed to publish post event', { error: error.stack });
    }
  }

  async publishComment(comment: any, type: 'comment:new' | 'comment:deleted') {
    try {
      await this.publisher.publish('posts', JSON.stringify({ type, comment }));
      this.logger.log(`Published ${type} for comment ${comment.id}`);
    } catch (error) {
      this.logger.error('Failed to publish comment event', {
        error: error.stack,
      });
    }
  }

  async onModuleDestroy() {
    try {
      // Clear all typing timeouts
      this.typingTimeouts.forEach((timeout) => clearTimeout(timeout));
      this.typingTimeouts.clear();

      await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
      this.logger.log('Redis Pub/Sub connections closed');
    } catch (error) {
      this.logger.error('Error during cleanup', error.stack);
    }
  }
}

// redis.pubsub.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Server } from 'socket.io';
import {
  PubSubFeedMessage,
  PubSubMessage,
  PubSubNotification,
} from './pubsub.types';
import { PrismaService } from '../prisma/prisma.service';
import { getRedisOptions } from 'src/config/runtime-env';

@Injectable()
export class RedisPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private io: Server;
  private typingTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly logger = new Logger(RedisPubSubService.name);

  constructor(private readonly prisma: PrismaService) {
    this.publisher = new Redis(getRedisOptions({
      enableOfflineQueue: false, // Disable queueing when Redis is down
      maxRetriesPerRequest: 1, // Fail fast if Redis is unavailable
    }));
    this.subscriber = new Redis(getRedisOptions({
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    }));
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
        this.subscriber.subscribe('posts'),
        this.subscriber.subscribe('carpool_updates'),
        this.subscriber.subscribe('feed'),
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
      } else if (channel === 'carpool_updates') {
        this.handleCarpoolUpdateMessage(payload);
      } else if (channel === 'feed') {
        // 👈 ADD THIS
        this.handleFeedMessage(payload);
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

  private handleCarpoolUpdateMessage(payload: {
    type: 'passenger_added' | 'passenger_removed' | 'carpool_updated';
    carpoolId: string;
    data: any;
    userId: string; // For passenger_added/removed
    timestamp?: string;
  }) {
    const { type, carpoolId, data, userId, timestamp } = payload;

    try {
      switch (type) {
        case 'passenger_added':
          this.handlePassengerAdded(carpoolId, userId, data);
          break;
        case 'passenger_removed':
          this.handlePassengerRemoved(carpoolId, userId, data);
          break;
        case 'carpool_updated':
          this.handleCarpoolUpdated(carpoolId, data, timestamp);
          break;
        default:
          this.logger.warn(`Unknown carpool update type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Error handling carpool update: ${type}`, {
        carpoolId,
        error: error.stack,
      });
    }
  }

  private async handlePassengerAdded(
    carpoolId: string,
    userId: string,
    data: any,
  ) {
    try {
      // Get carpool details
      const carpool = await this.prisma.carpool.findUnique({
        where: { id: carpoolId },
        include: {
          driver: {
            select: { id: true, username: true, profilePicUrlTN: true },
          },
          passengers: {
            where: { status: 'ACCEPTED' },
            include: {
              user: {
                select: { id: true, username: true, profilePicUrlTN: true },
              },
            },
          },
        },
      });

      if (!carpool) {
        this.logger.warn(`Carpool ${carpoolId} not found`);
        return;
      }

      // Notify all participants in the carpool room
      this.io.to(`carpool:${carpoolId}`).emit('passengerAdded', {
        carpoolId,
        passenger: {
          id: userId,
          avatar: data.profilePicUrlTN,
          status: data.status,
        },
      });

      // Notify the driver specifically
      // if (userId !== carpool.driverId) {
      //   this.io.to(`user:${carpool.driverId}`).emit('passenger_added', {
      //     carpoolId,
      //     userId,
      //     user: data.user,
      //     carpool,
      //     timestamp: new Date().toISOString()
      //   });
      // }

      // Notify the new passenger
      // this.io.to(`user:${userId}`).emit('passenger_added_confirmation', {
      //   carpoolId,
      //   carpool,
      //   timestamp: new Date().toISOString()
      // });

      this.logger.log(`Passenger ${userId} added to carpool ${carpoolId}`);
    } catch (error) {
      this.logger.error(`Error handling passenger_added`, {
        carpoolId,
        userId,
        error: error.stack,
      });
    }
  }

  // 👇 NEW: Handle passenger removed event
  private async handlePassengerRemoved(
    carpoolId: string,
    userId: string,
    data: any,
  ) {
    try {
      // Get updated carpool details
      const carpool = await this.prisma.carpool.findUnique({
        where: { id: carpoolId },
        include: {
          driver: {
            select: { id: true, username: true },
          },
          passengers: {
            where: { status: 'ACCEPTED' },
            include: {
              user: {
                select: { id: true, username: true },
              },
            },
          },
        },
      });

      if (!carpool) {
        this.logger.warn(`Carpool ${carpoolId} not found`);
        return;
      }

      // Notify all participants in the carpool room
      this.io.to(`carpool:${carpoolId}`).emit('passengerRemoved', {
        carpoolId,
        userId,
        passengerName: data.username,
      });

      // Notify the removed passenger
      // this.io.to(`user:${userId}`).emit('passenger_removed_notification', {
      //   carpoolId,
      //   reason: data.reason,
      //   timestamp: new Date().toISOString()
      // });

      // Clear user's unread messages for this carpool
      const unreadKey = `message:unread:${userId}:${carpoolId}`;
      await this.publisher.del(unreadKey);

      this.logger.log(`Passenger ${userId} removed from carpool ${carpoolId}`);
    } catch (error) {
      this.logger.error(`Error handling passenger_removed`, {
        carpoolId,
        userId,
        error: error.stack,
      });
    }
  }

  // 👇 NEW: Handle carpool updated event
  private async handleCarpoolUpdated(
    carpoolId: string,
    data: any,
    timestamp?: string,
  ) {
    try {
      // Get updated carpool details
      const carpool = await this.prisma.carpool.findUnique({
        where: { id: carpoolId },
        include: {
          driver: {
            select: { id: true, username: true },
          },
          passengers: {
            where: { status: 'ACCEPTED' },
            include: {
              user: {
                select: { id: true, username: true },
              },
            },
          },
        },
      });

      if (!carpool) {
        this.logger.warn(`Carpool ${carpoolId} not found`);
        return;
      }

      const updateData = {
        carpoolId,
        changes: data,
      };

      // Notify all participants in the carpool room
      this.io.to(`carpool:${carpoolId}`).emit('carpoolUpdated', updateData);

      // Also notify each participant individually (for cases where they're not in the room)
      // const participantIds = [
      //   carpool.driverId,
      //   ...carpool.passengers.map((p) => p.userId),
      // ];

      // participantIds.forEach((participantId) => {
      //   this.io.to(`user:${participantId}`).emit('carpool_updated', updateData);
      // });

      this.logger.log(`Carpool ${carpoolId} updated`);
    } catch (error) {
      this.logger.error(`Error handling carpool_updated`, {
        carpoolId,
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
      this.io.to(`user:${recipientId}`).emit('newNotification', payload);
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

  private handleFeedMessage(payload: PubSubFeedMessage) {
    const { type, eventId, feed, userId } = payload;

    try {
      const timestamp = new Date().toISOString();
      const feedRoom = `event:${eventId}:feed`;
      const legacyEventRoom = `event:${eventId}`;

      // Canonical feed socket contract consumed by gathergo-app.
      if (type === 'feed:new' && feed) {
        this.io.to(feedRoom).emit('newFeed', feed);
      } else if (type === 'feed:pinned' && feed) {
        this.io.to(feedRoom).emit('pinnedFeedUpdate', feed);
      } else if (type === 'feed:updated' && feed) {
        // Re-emit as newFeed so clients can upsert by id.
        this.io.to(feedRoom).emit('newFeed', feed);
      } else if (type === 'feed:deleted') {
        this.io
          .to(feedRoom)
          .emit('feedDeleted', { eventId, feedId: feed?.id || null });
      }

      // Backward-compatible legacy event payload.
      this.io.to(legacyEventRoom).emit(type, {
        feed,
        userId,
        timestamp,
      });

      this.logger.log(`Feed ${type} broadcasted for event ${eventId}`);
    } catch (error) {
      this.logger.error(`Error handling feed message: ${type}`, {
        eventId,
        error: error.stack,
      });
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

      console.log('sent notify', payload);
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

  async publishCarpoolUpdate(
    type: 'passenger_added' | 'passenger_removed' | 'carpool_updated',
    carpoolId: string,
    data: any,
    userId?: string,
    timestamp?: string,
  ) {
    try {
      const payload = {
        type,
        carpoolId,
        data,
        userId,
        timestamp: timestamp || new Date().toISOString(),
      };

      await this.publisher.publish('carpool_updates', JSON.stringify(payload));
      this.logger.log(`Published ${type} for carpool ${carpoolId}`);
    } catch (error) {
      this.logger.error('Failed to publish carpool update', {
        type,
        carpoolId,
        error: error.stack,
      });
      throw error;
    }
  }

  async publishFeed(
    type: 'feed:new' | 'feed:updated' | 'feed:deleted' | 'feed:pinned',
    eventId: string,
    feed: any,
    userId?: string,
  ) {
    try {
      const payload: PubSubFeedMessage = {
        type,
        eventId,
        feed,
        userId,
      };

      await this.publisher.publish('feed', JSON.stringify(payload));
      this.logger.log(
        `Published ${type} for feed ${feed.id} in event ${eventId}`,
      );
    } catch (error) {
      this.logger.error('Failed to publish feed message', {
        type,
        eventId,
        error: error.stack,
      });
      throw error;
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

// notification.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { CreateNotificationDto } from './dto/create-notification.dto';




@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisPubSub: RedisPubSubService
  ) {}

  async createNotification(data: CreateNotificationDto) {
    try {
      // Create in database
      const notification = await this.prisma.notification.create({
        data: {
          recipient: { connect: { id: data.recipientId } },
          sender: data.senderId ? { connect: { id: data.senderId } } : undefined,
          type: data.type,
          title: data.title,
          message: data.message,
          imageUrl: data.imageUrl ,
          link: data.link,
          read: false
        }
      });

      // Publish via Redis
      await this.redisPubSub.publishNotification({
     
        recipientId: data.recipientId,
        notificationType: data.type,
        senderId: data.senderId,
        data: {
          id: notification.id,
          title: notification.title,
          message: notification.message,
          imageUrl: notification.imageUrl ?? undefined,
          link: notification.link ?? undefined,
          createdAt: notification.createdAt,
          read: notification.read
        }
      });

      return notification ;
    } catch (error) {
      this.logger.error('Failed to create notification', error.stack);
      throw error;
    }
  }

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20
  ){
    // Promise<{ notifications: NotificationResponse[]; total: number }> 
    try {
      const [notifications, total] = await Promise.all([
        this.prisma.notification.findMany({
          where: { recipientId: userId },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: (page - 1) * limit,
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profilePicUrl: true
                
              }
            }
          }
        }),


        this.prisma.notification.count({
          where: { recipientId: userId }
        })
      ]);


      // Transform the results to convert null sender to undefined
    const transformedNotifications = notifications.map(notification => ({
      ...notification,
      sender: notification.sender ? {
        id: notification.sender.id,
        username: notification.sender.username ,
        profilePicUrl: notification.sender.profilePicUrl ?? undefined
      } : undefined
    }));

      return { notifications:transformedNotifications, total };
    } catch (error) {
      this.logger.error('Failed to get user notifications', error.stack);
      throw error;
    }
  }

  async markAsRead(userId: string, notificationId: string){
    try {
      // Verify the notification belongs to the user
      const notification = await this.prisma.notification.findUnique({
        where: { id: notificationId }
      });

      if (!notification || notification.recipientId !== userId) {
        throw new Error('Notification not found or access denied');
      }

      return await this.prisma.notification.update({
        where: { id: notificationId },
        data: { read: true }
      });
    } catch (error) {
      this.logger.error('Failed to mark notification as read', error.stack);
      throw error;
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    try {
      await this.prisma.notification.updateMany({
        where: { 
          recipientId: userId,
          read: false
        },
        data: { read: true }
      });
    } catch (error) {
      this.logger.error('Failed to mark all notifications as read', error.stack);
      throw error;
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await this.prisma.notification.count({
        where: { 
          recipientId: userId,
          read: false
        }
      });
    } catch (error) {
      this.logger.error('Failed to get unread count', error.stack);
      return 0;
    }
  }
}
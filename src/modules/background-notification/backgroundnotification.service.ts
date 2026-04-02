// notifications/notifications.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../firebase/firebase.service';
import { RedisService } from 'src/redis/redis.service';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';

export interface UserNotificationToken {
  userId: string;
  token: string;
  platform: string;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly REDIS_KEY_PREFIX = 'fcm_tokens';
  private readonly TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
  private readonly expo = new Expo();

  constructor(
    private firebaseService: FirebaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Register a user's FCM token
   */
  async registerToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<void> {
    try {
      // Validate token based on type
      if (this.isExpoPushToken(token)) {
        // Expo tokens don't need Firebase validation
      } else {
        // Validate FCM token with Firebase
        const { valid } = await this.firebaseService.validateTokens([token]);
        if (valid.length === 0) {
          this.logger.warn(`Invalid FCM token for user ${userId}`);
          return;
        }
      }

      // Remove this device token everywhere first so it belongs to only one user.
      await this.removeTokenByTokenValue(token);

      // Add new token
      const userToken: UserNotificationToken = {
        userId,
        token,
        platform,
        createdAt: new Date().toISOString(),
      };

      await this.addUserToken(userToken);

      this.logger.log(`Registered FCM token for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to register token for user ${userId}:`, error);
    }
  }

  /**
   * Remove a specific token for a user
   */
  async removeToken(userId: string, token: string): Promise<void> {
    await this.removeTokenByValue(userId, token);
    this.logger.log(`Removed FCM token for user ${userId}`);
  }

  /**
   * Remove all tokens for a user (on logout, etc.)
   */
  async removeAllUserTokens(userId: string): Promise<void> {
    const redisKey = this.getUserTokensKey(userId);
    await this.redisService.client.del(redisKey);
    this.logger.log(`Removed all FCM tokens for user ${userId}`);
  }

  /**
   * Get all valid tokens for a user
   */
  async getUserTokens(userId: string): Promise<string[]> {
    const tokens = await this.getUserTokenObjects(userId);

    if (tokens.length === 0) {
      return [];
    }

    // Validate tokens periodically
    const tokenStrings = tokens.map((t) => t.token);
    //const { valid } = await this.firebaseService.validateTokens(tokenStrings);
    //console.log(tokens, valid, 'valid tokens');
    // Update stored tokens - remove invalid ones
    //const validTokens = tokens.filter((t) => valid.includes(t.token));
    //await this.setUserTokens(userId, validTokens);

    return tokens.map((token) => token.token);
  }

  /**
   * Get tokens for multiple users
   */
  async getMultipleUserTokens(userIds: string[]): Promise<string[]> {
    const allTokens: string[] = [];

    for (const userId of userIds) {
      const tokens = await this.getUserTokens(userId);
      allTokens.push(...tokens);
    }

    return allTokens;
  }

  // Add to NotificationsService class

  /**
   * Send regular notification with custom title, message, link, and type
   */
  async sendRegularNotification({
    userIds,
    title,
    message,
    link,
    type,
    data = {},
  }: {
    userIds: string[];
    title: string;
    message: string;
    link?: string;
    type: string;
    data?: Record<string, any>;
  }): Promise<void> {
    try {
      // Get all tokens for all users
      const allTokens = await this.getMultipleUserTokens(userIds);

      if (allTokens.length === 0) {
        this.logger.log('No valid FCM tokens found for regular notification');
        return;
      }

      // Separate Expo and FCM tokens
      const { expoTokens, fcmTokens } = this.separateTokensByType(allTokens);

      // Send Expo notifications
      if (expoTokens.length > 0) {
        await this.sendExpoRegularNotification({
          tokens: expoTokens,
          title,
          message,
          link,
          type,
          data,
        });
      }

      // Send FCM notifications
      if (fcmTokens.length > 0) {
        await this.firebaseService.sendRegularNotification({
          tokens: fcmTokens,
          title,
          message,
          link,
          type,
          data,
        });
      }

      this.logger.log(
        `Sent regular notification "${title}" to ${allTokens.length} tokens for users: ${userIds.join(', ')}`,
      );
    } catch (error) {
      this.logger.error('Failed to send regular notification:', error);
    }
  }

  /**
   * Send regular notification via Expo
   */
  private async sendExpoRegularNotification({
    tokens,
    title,
    message,
    link,
    type,
    data = {},
  }: {
    tokens: string[];
    title: string;
    message: string;
    link?: string;
    type: string;
    data?: Record<string, any>;
  }): Promise<void> {
    try {
      const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));

      if (validTokens.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = validTokens.map((token) => ({
        to: token,
        sound: 'default',
        title,
        body: message,
        data: {
          type,
          link: link || '',
          ...data,
          timestamp: new Date().toISOString(),
        },
        badge: 1,
      }));

      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const receipts = await this.expo.sendPushNotificationsAsync(chunk);
          this.logger.log(`Sent ${chunk.length} Expo regular notifications`);

          // Check receipts for errors and remove invalid tokens
          await this.handleExpoReceipts(receipts, chunk);
        } catch (error) {
          this.logger.error(
            'Error sending Expo regular notification chunk:',
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to send Expo regular notification:', error);
    }
  }

  /**
   * Send new message notification
   */
  async sendMessageNotification({
    userIds,
    message,
    carpoolId,
    senderName,
    senderId,
    link,
  }: {
    userIds: string[];
    message: any;
    carpoolId?: string;
    senderName?: string;
    senderId?: string;
    link?: string;
  }): Promise<void> {
    try {
      // Get all tokens for all users
      const allTokens = await this.getMultipleUserTokens(userIds);

      if (allTokens.length === 0) {
        this.logger.log('No valid FCM tokens found for notification');
        return;
      }

      // Separate Expo and FCM tokens
      const { expoTokens, fcmTokens } = this.separateTokensByType(allTokens);

      // Send Expo notifications
      if (expoTokens.length > 0) {
        await this.sendExpoMessageNotification({
          tokens: expoTokens,
          message,
          carpoolId,
          senderName,
          senderId,
          link,
        });
      }

      // Send FCM notifications
      if (fcmTokens.length > 0) {
        await this.firebaseService.sendMessageNotification({
          tokens: fcmTokens,
          message,
          carpoolId,
          senderName,
          senderId,
          messageId: message.id,
        });
      }

      this.logger.log(
        `Sent message notification to ${allTokens.length} tokens for users: ${userIds.join(', ')}`,
      );
    } catch (error) {
      this.logger.error('Failed to send message notification:', error);
    }
  }

  /**
   * Get user statistics (for admin/debug purposes)
   */
  async getUserTokenStats(userId: string): Promise<{
    totalTokens: number;
    tokens: UserNotificationToken[];
  }> {
    const tokens = await this.getUserTokenObjects(userId);
    return {
      totalTokens: tokens.length,
      tokens,
    };
  }

  /**
   * Clean up expired tokens (older than 30 days)
   */
  async cleanupExpiredTokens(maxAgeDays: number = 30): Promise<void> {
    try {
      const pattern = `${this.REDIS_KEY_PREFIX}:*`;
      const keys = await this.redisService.client.keys(pattern);

      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const cutoffDate = new Date(Date.now() - maxAgeMs);

      for (const key of keys) {
        const tokens = await this.getUserTokenObjectsFromKey(key);
        const validTokens = tokens.filter(
          (token) => new Date(token.createdAt) > cutoffDate,
        );

        if (validTokens.length !== tokens.length) {
          await this.setUserTokensForKey(key, validTokens);
          this.logger.log(
            `Cleaned up ${tokens.length - validTokens.length} expired tokens from ${key}`,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired tokens:', error);
    }
  }

  // Private helper methods

  /**
   * Send notification via Expo
   */
  private async sendExpoMessageNotification({
    tokens,
    message,
    carpoolId,
    senderName,
    senderId,
    link,
  }: {
    tokens: string[];
    message: any;
    carpoolId?: string;
    senderName?: string;
    senderId?: string;
    link?: string;
  }): Promise<void> {
    try {
      const validTokens = tokens.filter((token) => Expo.isExpoPushToken(token));

      if (validTokens.length === 0) {
        return;
      }

      const messages: ExpoPushMessage[] = validTokens.map((token) => ({
        to: token,
        sound: 'default',
        title: senderName ? `New message from ${senderName}` : 'New message',
        body: message.content || 'You have a new message',
        data: {
          type: 'NEW_MESSAGE',
          carpoolId: carpoolId || message.carpoolId || '',
          messageId: message.id || '',
          senderId: senderId || message.senderId || '',
          senderName: senderName || message.sender?.username || '',
          content: message.content || '',
          createdAt: message.createdAt || new Date().toISOString(),
          link,
        },
        badge: 1,
      }));

      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const receipts = await this.expo.sendPushNotificationsAsync(chunk);
          this.logger.log(`Sent ${chunk.length} Expo notifications`);

          // Check receipts for errors and remove invalid tokens
          await this.handleExpoReceipts(receipts, chunk);
        } catch (error) {
          this.logger.error(
            'Error sending Expo push notification chunk:',
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to send Expo push notification:', error);
    }
  }

  /**
   * Handle Expo push receipts and remove invalid tokens
   */
  private async handleExpoReceipts(
    receipts: any[],
    messages: ExpoPushMessage[],
  ): Promise<void> {
    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i];
      const message = messages[i];

      if (receipt?.status === 'error') {
        const error = receipt.details?.error;
        if (error && this.isExpoTokenInvalid(error)) {
          // Remove invalid token
          const token = message.to as string;
          await this.removeTokenByTokenValue(token);
          this.logger.warn(`Removed invalid Expo token: ${token}`);
        }
      }
    }
  }

  /**
   * Remove token by token value (across all users)
   */
  private async removeTokenByTokenValue(tokenValue: string): Promise<void> {
    try {
      const pattern = `${this.REDIS_KEY_PREFIX}:*`;
      const keys = await this.redisService.client.keys(pattern);

      for (const key of keys) {
        const tokens = await this.getUserTokenObjectsFromKey(key);
        const filteredTokens = tokens.filter((t) => t.token !== tokenValue);

        if (filteredTokens.length !== tokens.length) {
          await this.setUserTokensForKey(key, filteredTokens);
        }
      }
    } catch (error) {
      this.logger.error('Failed to remove token by value:', error);
    }
  }
  /**
   * Check if Expo error indicates invalid token
   */
  private isExpoTokenInvalid(error: string): boolean {
    const invalidErrors = [
      'DeviceNotRegistered',
      'InvalidCredentials',
      'MessageTooBig',
      'MessageRateExceeded',
    ];
    return invalidErrors.includes(error);
  }

  /**
   * Check if token is an Expo push token
   */
  private isExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  /**
   * Separate tokens by type (Expo vs FCM)
   */
  private separateTokensByType(tokens: string[]): {
    expoTokens: string[];
    fcmTokens: string[];
  } {
    const expoTokens: string[] = [];
    const fcmTokens: string[] = [];

    tokens.forEach((token) => {
      if (this.isExpoPushToken(token)) {
        expoTokens.push(token);
      } else {
        fcmTokens.push(token);
      }
    });

    return { expoTokens, fcmTokens };
  }

  private getUserTokensKey(userId: string): string {
    return `${this.REDIS_KEY_PREFIX}:${userId}`;
  }

  private async getUserTokenObjects(
    userId: string,
  ): Promise<UserNotificationToken[]> {
    return this.getUserTokenObjectsFromKey(this.getUserTokensKey(userId));
  }

  private async getUserTokenObjectsFromKey(
    redisKey: string,
  ): Promise<UserNotificationToken[]> {
    try {
      const data = await this.redisService.client.get(redisKey);
      if (!data) {
        return [];
      }

      // Handle both string (JSON) and already parsed array
      if (typeof data === 'string') {
        return JSON.parse(data) as UserNotificationToken[];
      }

      // If it's already an array, return it
      if (Array.isArray(data)) {
        return data as UserNotificationToken[];
      }

      return [];
    } catch (error) {
      this.logger.error(
        `Failed to parse tokens from Redis key ${redisKey}:`,
        error,
      );
      return [];
    }
  }

  private async setUserTokens(
    userId: string,
    tokens: UserNotificationToken[],
  ): Promise<void> {
    await this.setUserTokensForKey(this.getUserTokensKey(userId), tokens);
  }

  private async setUserTokensForKey(
    redisKey: string,
    tokens: UserNotificationToken[],
  ): Promise<void> {
    try {
      await this.redisService.client.set(
        redisKey,
        JSON.stringify(tokens),
        'EX',
        this.TOKEN_TTL,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set tokens in Redis key ${redisKey}:`,
        error,
      );
    }
  }

  private async addUserToken(token: UserNotificationToken): Promise<void> {
    const tokens = await this.getUserTokenObjects(token.userId);

    // Remove any existing token with the same value
    const filteredTokens = tokens.filter((t) => t.token !== token.token);
    filteredTokens.push(token);

    await this.setUserTokens(token.userId, filteredTokens);
  }

  private async removeTokenByValue(
    userId: string,
    tokenValue: string,
  ): Promise<void> {
    const tokens = await this.getUserTokenObjects(userId);
    const filteredTokens = tokens.filter((t) => t.token !== tokenValue);
    await this.setUserTokens(userId, filteredTokens);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuid } from 'uuid';
import { Bucket } from '@google-cloud/storage';
import * as sharp from 'sharp';
import { getNotificationSound } from '../notification/notification-sounds';
import type { ChatNotificationMessage } from '../notification/notification.types';

@Injectable()
export class FirebaseService {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp: admin.app.App;
  private bucket: Bucket;

  constructor() {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON!,
    );

    this.firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });
    this.bucket = admin.storage().bucket();
  }

  getApp(): admin.app.App {
    return this.firebaseApp;
  }
  getBucket() {
    return this.bucket;
  }

  /**
   * Send push notifications, handles chunking for >500 tokens, logs results
   */
  async sendPushNotification(
    tokens: string | string[],
    payload: Omit<admin.messaging.MulticastMessage, 'tokens'>,
  ) {
    const allTokens = Array.isArray(tokens) ? tokens : [tokens];
    const CHUNK_SIZE = 500;

    const chunks = this.chunkArray(allTokens, CHUNK_SIZE);

    const results: {
      successCount: number;
      failureCount: number;
      errors: { error: any; token: string }[];
    }[] = [];

    for (const chunk of chunks) {
      try {
        const message: admin.messaging.MulticastMessage = {
          tokens: chunk,
          ...payload,
        };

        const response = await this.firebaseApp
          .messaging()
          .sendEachForMulticast(message);

        const successCount = response.successCount;
        const failureCount = response.failureCount;

        const errors = response.responses
          .map((r, idx) => ({ error: r.error, token: chunk[idx] }))
          .filter((r) => r.error);

        this.logger.log(
          `Chunk Result: ${successCount} success, ${failureCount} failure`,
        );

        if (errors.length > 0) {
          errors.forEach((e) =>
            this.logger.warn(
              `Failed token: ${e.token}, Error: ${e.error?.message}`,
            ),
          );
        }

        results.push({ successCount, failureCount, errors });
      } catch (error) {
        this.logger.error(
          `Failed to send push notification chunk`,
          error.stack,
        );
        results.push({
          successCount: 0,
          failureCount: chunk.length,
          errors: chunk.map((t) => ({ error, token: t })),
        });
      }
    }

    return results;
  }

  /**
   * Send message notification to specific users
   */
  async sendMessageNotification({
    tokens,
    message,
    carpoolId,
    senderName,
    senderId,
    messageId,
  }: {
    tokens: string | string[];
    message: ChatNotificationMessage;
    carpoolId?: string;
    senderName?: string;
    senderId?: string;
    messageId?: string;
  }) {
    const { sound, channelId } = getNotificationSound('NEW_MESSAGE');
    const payload: Omit<admin.messaging.MulticastMessage, 'tokens'> = {
      notification: {
        title: senderName ? `New message from ${senderName}` : 'New message',
        body: message.content,
      },
      data: {
        type: 'NEW_MESSAGE',
        message: JSON.stringify(message),
        carpoolId: carpoolId || message.carpoolId || '',
        messageId: messageId || message.id || '',
        senderId: senderId || message.senderId || '',
        senderName: senderName || message.sender?.username || '',
        content: message.content || '',
        createdAt: message.createdAt.toISOString(),
        // Ensure consistent data structure with Expo
        screen: 'Chat',
      },
      android: {
        priority: 'high',
        notification: { channelId, sound: sound.replace('.wav', '') },
      },
      apns: { payload: { aps: { sound, badge: 1 } } },
    };

    return this.sendPushNotification(tokens, payload);
  }

  async validateTokens(
    tokens: string[],
  ): Promise<{ valid: string[]; invalid: string[] }> {
    if (tokens.length === 0) {
      return { valid: [], invalid: [] };
    }

    try {
      const response = await this.firebaseApp.messaging().sendEachForMulticast({
        tokens,
        // Empty notification just for validation
        notification: { title: '', body: '' },
      });

      const validTokens: string[] = [];
      const invalidTokens: string[] = [];

      response.responses.forEach((result, index) => {
        if (result.success) {
          validTokens.push(tokens[index]);
        } else {
          invalidTokens.push(tokens[index]);
          this.logger.warn(
            `Invalid FCM token: ${tokens[index]}, Error: ${result.error?.message}`,
          );
        }
      });

      return { valid: validTokens, invalid: invalidTokens };
    } catch (error) {
      this.logger.error('Token validation failed:', error);
      return { valid: [], invalid: tokens };
    }
  }

  async uploadPostMedia(
    buffer: Buffer,
    mimeType: string,
    originalName: string,
    folder = 'posts',
  ): Promise<string> {
    if (!mimeType.startsWith('image/')) {
      throw new Error('Only image uploads are allowed.');
    }
    const ext = originalName.split('.').pop();
    const filename = `${folder}/${uuid()}.${ext}`;
    const file = this.bucket.file(filename);

    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: {
        firebaseStorageDownloadTokens: uuid(),
      },
    });

    return this.getPublicUrl(filename);
  }

  // Add to FirebaseService class

  /**
   * Send regular notification via FCM
   */
  async sendRegularNotification({
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
      if (tokens.length === 0) {
        return;
      }

      const { sound, channelId } = getNotificationSound(type, data);
      const messagePayload: Omit<admin.messaging.MulticastMessage, 'tokens'> = {
        notification: {
          title,
          body: message,
        },
        data: Object.fromEntries(
          Object.entries({
            type,
            title,
            message,
            link: link || '',
            timestamp: new Date().toISOString(),
            ...data,
          })
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            ]),
        ),
        android: {
          priority: 'high',
          notification: {
            channelId,
            sound: sound.replace('.wav', ''),
            priority: 'high',
          },
        },
        apns: {
          payload: {
            aps: {
              sound,
              badge: 1,
            },
          },
        },
      };

      await this.sendPushNotification(tokens, messagePayload);
    } catch (error) {
      this.logger.error('Failed to send regular notification via FCM:', error);
      throw error;
    }
  }

  async uploadResizedImage(
    buffer: Buffer,
    width: number,
    quality: number,
    folder: string,
    suffix: string = '',
  ): Promise<string> {
    const filename = `${folder}/${uuid()}${suffix}.jpg`;
    const file = this.bucket.file(filename);

    const resizedBuffer = await sharp(buffer)
      .resize(width)
      .jpeg({ quality })
      .toBuffer();

    await file.save(resizedBuffer, {
      contentType: 'image/jpeg',
      resumable: false,
      metadata: {
        firebaseStorageDownloadTokens: uuid(),
      },
    });

    return this.getPublicUrl(filename);
  }

  async deleteFile(path: string): Promise<void> {
    const file = this.bucket.file(path); // Assuming `this.bucket` is your Firebase Storage bucket
    await file.delete();
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      result.push(array.slice(i, i + size));
    }
    return result;
  }
  private getPublicUrl(filePath: string) {
    return `https://firebasestorage.googleapis.com/v0/b/${this.bucket.name}/o/${encodeURIComponent(filePath)}?alt=media`;
  }
}

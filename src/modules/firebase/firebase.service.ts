import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { v4 as uuid } from 'uuid';
import { Bucket } from '@google-cloud/storage';
import * as sharp from 'sharp';

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
    payload: admin.messaging.MessagingPayload,
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
    message: any;
    carpoolId?: string;
    senderName?: string;
    senderId?: string;
    messageId?: string;
  }) {
    const payload: admin.messaging.MessagingPayload = {
      notification: {
        title: `New message from ${'test sender'}`,
        body: message.content,
        sound: 'default',
        badge: '1',
      },
      data: {
        type: 'NEW_MESSAGE',
        message,
        carpoolId: carpoolId || message.carpoolId || '',
        messageId: messageId || message.id || '',
        senderId: senderId || message.senderId || '',
        senderName: senderName || message.sender?.username || '',
        content: message.content || '',
        createdAt: message.createdAt || new Date().toISOString(),
        // Ensure consistent data structure with Expo
        screen: 'Chat',
      },
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

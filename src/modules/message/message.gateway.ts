// src/message/message.gateway.ts
import {
  SubscribeMessage,
  WebSocketGateway,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { HttpException, Logger, UseGuards } from '@nestjs/common';
import { MessageService } from './message.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { BaseGateway } from 'src/common/base.gateway';
import { CreateMessageDto } from './dtos/create-message.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@UseGuards(WsJwtGuard)
export class MessageGateway extends BaseGateway {
  protected logger: Logger = new Logger('MessageGateway');

  constructor(
    private readonly messageService: MessageService,
    pubsubService: RedisPubSubService,
    // private readonly carpoolValidationService: CarpoolValidationService,
    private readonly prisma: PrismaService,
  ) {
    super(pubsubService);
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { carpoolId: string; limit?: number },
  ) {
    const { carpoolId, limit = 20 } = data;

    const hasAccess = await this.validateCarpoolAccess(
      client,
      carpoolId,
      this.prisma,
    );
    if (!hasAccess) return;

    client.join(`carpool:${carpoolId}`);

    const messages = await this.messageService.getMessagesCursor(
      carpoolId,
      limit,
      undefined,
      undefined,
    );

    this.logger.log(`Client ${client.id} join carpool:${data.carpoolId}`);

    client.emit('chatHistory', {
      carpoolId,
      messages,
      hasMore: messages.length === limit,
    });
  }

  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { carpoolId: string },
  ) {
    client.leave(`carpool:${data.carpoolId}`);
    this.logger.log(`Client ${client.id} left carpool:${data.carpoolId}`);
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { carpoolId: string; isTyping: boolean },
  ) {
    const userId = client.handshake.auth.userId;
    if (!userId) return;

    const hasAccess = await this.validateCarpoolAccess(
      client,
      data.carpoolId,
      this.prisma,
    );
    if (!hasAccess) return;

    this.pubsubService.publish({
      type: 'typing',
      carpoolId: data.carpoolId,
      senderId: userId,
      isTyping: data.isTyping,
    });
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: CreateMessageDto & { carpoolId: string },
  ) {
    const userId = this.getUserId(client);
    if (!userId)
      return { ok: false as const, error: 'Unauthorized', retryable: false };
    try {
      if (
        typeof payload.carpoolId !== 'string' ||
        !payload.carpoolId ||
        typeof payload.content !== 'string' ||
        !payload.content.trim() ||
        typeof payload.tempId !== 'string' ||
        !payload.tempId
      ) {
        return {
          ok: false as const,
          error: 'Invalid message',
          retryable: false,
        };
      }
      // The service authorizes new sends; a saved retry remains confirmable
      // even if the original confirmation was lost before the chat expired.
      const message = await this.messageService.createMessage(
        userId,
        payload.carpoolId,
        { content: payload.content, tempId: payload.tempId },
      );
      return { ok: true as const, message };
    } catch (error) {
      const retryable =
        !(error instanceof HttpException) || error.getStatus() >= 500;
      if (retryable) this.logger.error('Message delivery failed', error);
      return {
        ok: false as const,
        error:
          error instanceof HttpException
            ? error.message
            : 'Unable to send message. Please try again.',
        retryable,
      };
    }
  }

  @SubscribeMessage('markMsgAsRead')
  async handleMarkAsRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { carpoolId: string },
  ) {
    const userId = client.handshake.auth.user.sub;
    console.log(userId, 'userId');

    const hasAccess = await this.validateCarpoolAccess(
      client,
      data.carpoolId,
      this.prisma,
    );
    if (!hasAccess) return;
    await this.messageService.markMessagesAsRead(userId, data.carpoolId);

    const totalUnread = await this.messageService.getTotalUnreadCount(userId);

    client.emit('unreadCountUpdate', {
      carpoolId: data.carpoolId,
      unreadCount: 0,
      totalUnread,
    });
    client.emit('conversationTrayUpdate', {
      carpoolId: data.carpoolId,
      unreadCount: 0,
    });
  }

  @SubscribeMessage('loadMoreMessages')
  async handleLoadMoreMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      carpoolId: string;
      before?: string; // timestamp
      beforeId?: string; // message id
      limit?: number;
    },
  ) {
    const { carpoolId, before, beforeId, limit = 20 } = data;

    const hasAccess = await this.validateCarpoolAccess(
      client,
      carpoolId,
      this.prisma,
    );
    if (!hasAccess) return;

    const messages = await this.messageService.getMessagesCursor(
      carpoolId,
      limit,
      before,
      beforeId,
    );

    const hasMore = messages.length === limit;

    client.emit('chatHistory', {
      carpoolId,
      messages,
      hasMore,
    });
  }

  @SubscribeMessage('getConversationTray')
  async handleLoadConversationTray(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const userId = client.handshake.auth.userId;
    const tray = await this.messageService.getConversationTray(userId);
    console.log(tray, 'convo tray');
    client.emit('conversationTrayUpdate', tray);
  }

  @SubscribeMessage('getUnreadCount')
  async handleGetUnreadCount(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { userId: string },
  ) {
    const totalUnread = await this.messageService.getTotalUnreadCount(
      data.userId,
    );
    const unreadByCarpool = await this.messageService.getUnreadByCarpool(
      data.userId,
    );
    client.emit('unreadCountUpdate', {
      totalUnread,
      unreadByCarpool,
    });
  }

  async pushConversationTray(userId: string, tray: any) {
    this.server.to(`user:${userId}`).emit('conversationTrayUpdate', tray);
  }
}

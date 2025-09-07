// src/message/message.gateway.ts
import {
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    MessageBody,
    ConnectedSocket,
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  import { Logger, UseGuards } from '@nestjs/common';
  import { MessageService } from './message.service';
  import { CreateMessageDto } from './dtos/create-message.dto';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { SocketAuthMiddleware } from 'src/common/middleware/ws.mw';



  
  @WebSocketGateway({ 
    cors: {
        origin: '*',
      },
})


@UseGuards(WsJwtGuard)
  export class MessageGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
  {
    @WebSocketServer() server: Server;
    private logger: Logger = new Logger('MessageGateway');
  
    constructor(
      private readonly pubsubService: RedisPubSubService,
      private readonly messageService: MessageService,
      private readonly prisma: PrismaService
    ) {}
  
    afterInit(server: Server) {
      this.server = server;
    
      // Apply your custom auth middleware globally to all socket connections
      this.server.use(SocketAuthMiddleware() as any);
    
      // Set the socket server on Redis pubsub service
      this.pubsubService.setSocketServer(server);
    
      this.logger.log('Notification Gateway initialized and middleware set');
    }
    
    
  
    handleConnection(client: Socket) {
      const userId = client.handshake.auth.userId;
      if (userId) {
        client.join(`user:${userId}`);
        this.logger.log(`Client ${client.id} connected (user ${userId})`);
      } else {
        this.logger.warn(`Client ${client.id} connected without auth`);
        client.disconnect()
      }
    }
  
    handleDisconnect(client: Socket) {
      this.logger.log(`Client ${client.id} disconnected`);
    }
  
    @SubscribeMessage('join')
    async handleJoin(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { carpoolId: string; page?: number; limit?: number ;userId:string},
    ) {
      const { carpoolId, page = 1, limit = 20 } = data;
      client.join(`carpool:${carpoolId}`);
      this.logger.log(`Client ${client.id} joined carpool:${carpoolId}`);
    
      const messages = await this.messageService.getMessages(carpoolId, page, limit);
    
      // Send back to just the requesting client
      client.emit('chatHistory', {
        carpoolId,
        messages,
        page,
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
    handleTyping(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { carpoolId: string; isTyping: boolean },
    ) {
      const userId = client.handshake.auth.userId;
      if (!userId) return;
  
      this.pubsubService.publish({
        type: 'typing',
        carpoolId: data.carpoolId,
        senderId: userId,
        isTyping: data.isTyping
      });
    }
  
   
    @SubscribeMessage('sendMessage')
    async handleSendMessage(
      @ConnectedSocket() client: Socket,
      @MessageBody() payload: {  carpoolId: string; content: CreateMessageDto},
    ) {
        const userId =client.handshake.auth.user.sub
      const message = await this.messageService.createMessage(
        userId,
        payload.carpoolId,
        payload.content ,
      );

  
  
     
    
    }
  
    @SubscribeMessage('markMsgAsRead')
    async handleMarkAsRead(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { carpoolId: string },
    ) {
        const userId = client.handshake.auth.user.sub
        console.log(userId,"userId")
      await this.messageService.markMessagesAsRead(userId, data.carpoolId);
      
      client.to(`user:${userId}`).emit('unreadCountUpdate', {
        carpoolId: data.carpoolId,
        unreadCount: 0,
      });
      client.emit('conversationTrayUpdate', {
        carpoolId: data.carpoolId,
        unreadCount: 0,
      });

    }



    @SubscribeMessage('loadMoreMessages')
async handleLoadMoreMessages(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: {
    carpoolId: string;
    page?: number;
    limit?: number;
  },
) {
  const { carpoolId, page = 1, limit = 20 } = data;

  const messages = await this.messageService.getMessages(carpoolId, page, limit);
  const totalCount = await this.prisma.message.count({ where: { carpoolId } });
    const hasMore = page * limit < totalCount;

  client.emit('chatHistory', {
    carpoolId,
    messages,
    page,
    hasMore
  });
}

@SubscribeMessage('loadConversationTray')
async handleLoadConversationTray(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { userId: string },
) {
  const tray = await this.messageService.getConversationTray(data.userId);

  client.emit('conversationTrayLoaded', tray);
}


@SubscribeMessage('getUnreadCount')
async handleGetUnreadCount(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { userId: string },
) {
  const totalUnread = await this.messageService.getTotalUnreadCount(data.userId);
  const unreadByCarpool = await this.messageService.getUnreadByCarpool(data.userId);
  client.emit('unreadCountUpdate', {
    totalUnread,
    unreadByCarpool
  });
}

// @SubscribeMessage('joinUserRoom')
// async handleJoinUserRoom(@ConnectedSocket() client: Socket, @MessageBody() data: { userId: string }) {
//   client.join(`user:${data.userId}`);
//   const totalUnread = await this.messageService.getTotalUnreadCount(data.userId);
//   const unreadByCarpool = await this.messageService.getUnreadByCarpool(data.userId);
//   client.emit('unreadCountUpdate', {
//     totalUnread,
//     unreadByCarpool
//   });
 
// }



  }

  
  
// notification.gateway.ts
import { 
    WebSocketGateway, 
    WebSocketServer, 
    SubscribeMessage,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  import { Logger, UseGuards} from '@nestjs/common';
  import { NotificationService } from './notification.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { SocketAuthMiddleware } from 'src/common/middleware/ws.mw';

  
  @WebSocketGateway({ 
    cors: true 
  })


  @UseGuards(WsJwtGuard)
  export class NotificationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    // In your gateway
    private logger: Logger = new Logger('NotificationGateway');
  
    constructor(
      private readonly notificationService: NotificationService,
      private readonly pubsubService: RedisPubSubService
    ) {}
  
    // afterInit(server: Server) {
    //     this.pubsubService.setSocketServer(server)
    //   this.logger.log('Notification Gateway initialized');
    // }


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
        
        // Send unread count on connection
        this.notificationService.getUnreadCount(userId)
          .then(count => {
            client.emit('unreadCount', count);
          });

         
      } else {
        this.logger.warn(`Client ${client.id} connected without auth`);
        client.disconnect();
      }
    }
  
    handleDisconnect(client: Socket) {
      this.logger.log(`Client ${client.id} disconnected`);
    }
  
    @SubscribeMessage('markAsRead')
    async handleMarkAsRead(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { notificationId: string }
    ) {
      const userId = client.handshake.auth.user.sub;
      if (!userId) return;
  
      try {
        const updated = await this.notificationService.markAsRead(userId, data.notificationId);
        client.emit('notificationRead', updated);
        
        // Update unread count
        const newCount = await this.notificationService.getUnreadCount(userId);
        client.emit('unreadCount', newCount);
      } catch (error) {
        this.logger.error(`Error marking notification as read`, error.stack);
        client.emit('error', { message: 'Failed to mark notification as read' });
      }
    }
  
    @SubscribeMessage('markAllAsRead')
    async handleMarkAllAsRead(@ConnectedSocket() client: Socket) {
      const userId = client.handshake.auth.user.sub;
      if (!userId) return;
  
      try {
        await this.notificationService.markAllAsRead(userId);
        client.emit('allNotificationsRead');
        client.emit('unreadCount', 0);
      } catch (error) {
        this.logger.error(`Error marking all notifications as read`, error.stack);
        client.emit('error', { message: 'Failed to mark all notifications as read' });
      }
    }
  
    @SubscribeMessage('getNotifications')
    async handleGetNotifications(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { page?: number; limit?: number }
    ) {
      const userId = client.handshake.auth.user.sub;
     
      if (!userId) return;
  
      try {
        const { notifications, total } = await this.notificationService.getUserNotifications(
          userId,
          data.page || 1,
          data.limit || 20
        );
      
        client.emit('notifications', { notifications, total });
      } catch (error) {
        this.logger.error(`Error getting notifications`, error.stack);
        client.emit('error', { message: 'Failed to get notifications' });
      }
    }

    @SubscribeMessage('joinUserRoom')
async handleJoinUserRoom(@ConnectedSocket() client: Socket) {

    const userId = client.handshake.auth.user.sub;
     console.log("ojuju", userId);
     
    if (!userId) return;
  client.join(`user:${userId}`);
 
 
}

// notification.gateway.ts
@SubscribeMessage('testNotification')
async handleTestNotification(
  @ConnectedSocket() client: Socket,
  @MessageBody() data: { recipientId: string }
) {
  const userId:string = client.handshake.auth.user.sub;
  if (!userId) {
    return { error: 'Unauthorized' };
  }

  try {
    // Create a test notification payload
    const testNotification = {
     notificationType: "system",
     recipientId: data.recipientId || userId,
     data: {id: 'test-' + Date.now(),
      type: 'system',
      title: 'Test Notification',
      message: 'This is a test notification sent from the client',
      read: false,
      createdAt: new Date(),
      sender: {
        id: 'system',
        username: 'System',
        profilePicUrl: null
      }}
    };

    // Emit to the specified recipient
    //this.server.to(`user:${data.recipientId}`).emit('notification', testNotification);

    this.pubsubService.publishNotification(testNotification)
    
    return { success: true, notification: testNotification };
  } catch (error) {
    this.logger.error('Failed to send test notification', error.stack);
    return { error: 'Failed to send test notification' };
  }
}
  }
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
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { SocketAuthMiddleware } from 'src/common/middleware/ws.mw';
import { NotificationsService } from './background.notification.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@UseGuards(WsJwtGuard)
export class BackgroundNotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('BackgroundNotificationGateway');

  constructor(
    private notificationsService: NotificationsService,
    private readonly pubsubService: RedisPubSubService,
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
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('registerPushToken')
  async handleRegisterPushToken(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string; platform: 'ios' | 'android' },
  ) {
    await this.notificationsService.registerToken(
      client.data.userId,
      data.token,
      data.platform,
    );
    return { status: 'success' };
  }

  @SubscribeMessage('removePushToken')
  async handleRemovePushToken(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { token: string },
  ) {
    await this.notificationsService.removeToken(client.data.userId, data.token);
    return { status: 'success' };
  }
}

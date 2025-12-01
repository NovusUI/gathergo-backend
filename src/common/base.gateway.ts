// src/common/base.gateway.ts
import { WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import {
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { SocketAuthMiddleware } from './middleware/ws.mw';

export abstract class BaseGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  protected abstract logger: Logger;

  constructor(protected readonly pubsubService: RedisPubSubService) {}

  afterInit(server: Server) {
    this.server = server;
    this.server.use(SocketAuthMiddleware() as any);
    this.pubsubService.setSocketServer(server);
    this.logger.log(`${this.constructor.name} initialized and middleware set`);
  }

  handleConnection(client: Socket) {
    const userId = this.getUserId(client);
    if (userId) {
      client.join(`user:${userId}`);
      this.logger.log(`Client ${client.id} connected (user ${userId})`);
      this.onUserConnected(client, userId);
    } else {
      this.logger.warn(`Client ${client.id} connected without auth`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  protected onUserConnected(client: Socket, userId: string) {
    // Optional: Override in child classes for gateway-specific connection logic
  }

  protected emitError(client: Socket, message: string, error?: any) {
    this.logger.error(message, error?.stack);
    client.emit('error', { message });
  }

  protected getUserId(client: Socket): string | null {
    return client.handshake.auth.user?.sub || client.handshake.auth.userId;
  }

  protected validateUser(client: Socket): string | null {
    const userId = this.getUserId(client);
    if (!userId) {
      this.emitError(client, 'Unauthorized');
    }
    return userId;
  }
}

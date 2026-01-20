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
import { PrismaService } from 'src/prisma/prisma.service';

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

  protected async validateCarpoolAccess(
    client: Socket,
    carpoolId: string,
    prisma: PrismaService,
  ): Promise<boolean> {
    const userId = this.validateUser(client);
    if (!userId) {
      //this.emitError(client, 'Unauthorized');
      return false;
    }

    try {
      console.log(userId, carpoolId);
      const validationResult = await this.validateCarpoolAccessDetailed(
        prisma,
        userId,
        carpoolId,
      );

      if (!validationResult.hasAccess) {
        console.log(validationResult, 'this is result');
        this.emitError(
          client,
          validationResult.reason || 'No access to this carpool',
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Error validating carpool access: ${error.message}`);
      this.emitError(client, 'Error validating access');
      return false;
    }
  }

  private async validateCarpoolAccessDetailed(
    prisma: PrismaService,
    userId: string,
    carpoolId: string,
  ): Promise<{ hasAccess: boolean; reason?: string }> {
    // Your validation logic here
    const carpool = await prisma.carpool.findUnique({
      where: { id: carpoolId },
    });

    if (!carpool) {
      return { hasAccess: false, reason: 'Carpool not found' };
    }

    if (carpool.status !== 'ACTIVE') {
      return { hasAccess: false, reason: 'Carpool is not active' };
    }

    if (carpool.expiresAt && carpool.expiresAt < new Date()) {
      return { hasAccess: false, reason: 'Carpool has expired' };
    }

    // Check user access...
    const isDriver = carpool.driverId === userId;
    const isPassenger = await this.isAcceptedPassenger(
      prisma,
      userId,
      carpoolId,
    );

    if (!isDriver && !isPassenger) {
      return {
        hasAccess: false,
        reason: 'You are not a member of this carpool',
      };
    }

    return { hasAccess: true };
  }

  private async isAcceptedPassenger(
    prisma: PrismaService,
    userId: string,
    carpoolId: string,
  ): Promise<boolean> {
    // Example Prisma query - adjust based on your schema
    const carpool = await prisma.carpool.findUnique({
      where: { id: carpoolId },
      include: {
        passengers: {
          where: { userId, status: 'ACCEPTED' },
        },
        // OR if you have a separate CarpoolMember table:
        // carpoolMembers: {
        //   where: { userId },
        // },
      },
    });

    if (!carpool) return false;

    // Check based on your schema
    return carpool.passengers.length > 0; // If members is an array of users
    // OR: return carpool.carpoolMembers.length > 0; // If separate join table
  }
}

// src/common/guards/ws-jwt.guard.ts
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { getJwtSecret } from 'src/config/runtime-env';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();

    try {
      const payload = await WsJwtGuard.extractTokenFromSocket(
        client,
        this.jwtService,
      );

      client.handshake.auth.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  static async extractTokenFromSocket(client: Socket, jwtService: JwtService) {
    const token = client.handshake.auth?.token;

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      const payload = await jwtService.verifyAsync(token, {
        secret: getJwtSecret(),
      });
      return payload;
    } catch (err) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}

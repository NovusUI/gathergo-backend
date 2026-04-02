import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { getJwtSecret } from 'src/config/runtime-env';
import { WsJwtGuard } from '../guards/ws-jwt.guard';

export type SocketIOMiddleware = {
  (client: Socket, next: (err?: Error) => void);
};

export const SocketAuthMiddleware = (): SocketIOMiddleware => {
  const jwtService = new JwtService({
    secret: getJwtSecret(),
  });

  return async (client, next) => {
    try {
      await WsJwtGuard.extractTokenFromSocket(client, jwtService);
      next();
    } catch (error) {
      next(error);
    }
  };
};

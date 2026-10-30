import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebSessionService } from './web-session.service';

export type WebSessionContext = Awaited<
  ReturnType<WebSessionService['authenticate']>
>;
type WebRequest = Request & { webSession: WebSessionContext };

@Injectable()
export class WebSessionGuard implements CanActivate {
  constructor(private readonly sessions: WebSessionService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<WebRequest>();
    const match = /^Bearer ([a-f0-9]{64})$/.exec(
      request.headers.authorization ?? '',
    );
    if (!match)
      throw new UnauthorizedException('Verify your email to continue.');
    request.webSession = await this.sessions.authenticate(match[1]);
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return true;
  }
}

export const CurrentWebSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<WebRequest>().webSession,
);

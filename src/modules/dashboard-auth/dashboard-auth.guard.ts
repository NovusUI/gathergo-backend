import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DashboardRole } from '@prisma/client';
import type { Response } from 'express';
import { DASHBOARD_ACCESS } from './dashboard-auth.types';
import type {
  DashboardAccessMode,
  DashboardRequest,
} from './dashboard-auth.types';
import { DashboardAuthService } from './dashboard-auth.service';
import { assertDashboardAccess } from './dashboard-auth.policy';

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<DashboardRequest>();
    const header = request.headers.authorization;
    const token =
      typeof header === 'string'
        ? /^Bearer ([a-f0-9]{64})$/.exec(header)?.[1]
        : undefined;
    if (!token) throw new UnauthorizedException('Sign in to the dashboard.');
    const session = await this.auth.authenticate(token);
    const mode = this.reflector.getAllAndOverride<DashboardAccessMode>(
      DASHBOARD_ACCESS,
      [context.getHandler(), context.getClass()],
    );
    if (mode !== 'password')
      assertDashboardAccess(
        session.user,
        mode === 'admin' ? DashboardRole.ADMIN : undefined,
      );
    request.dashboard = session;
    context
      .switchToHttp()
      .getResponse<Response>()
      .setHeader('Cache-Control', 'no-store');
    return true;
  }
}

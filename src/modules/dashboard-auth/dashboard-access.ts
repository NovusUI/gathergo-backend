import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Public } from 'src/common/decorators/public.decorator';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DASHBOARD_ACCESS } from './dashboard-auth.types';
import type {
  DashboardAccessMode,
  DashboardRequest,
} from './dashboard-auth.types';

export const DashboardAccess = (mode: DashboardAccessMode = 'read') =>
  applyDecorators(
    Public(),
    SetMetadata(DASHBOARD_ACCESS, mode),
    UseGuards(DashboardAuthGuard),
  );
export const CurrentDashboard = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<DashboardRequest>().dashboard,
);

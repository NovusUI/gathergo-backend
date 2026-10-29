import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DashboardAccountStatus, DashboardRole } from '@prisma/client';
import type { DashboardActor } from './dashboard-auth.types';

export function assertDashboardAccess(
  actor: DashboardActor,
  requiredRole?: DashboardRole,
) {
  if (actor.status !== DashboardAccountStatus.ACTIVE)
    throw new UnauthorizedException('Dashboard account is disabled.');
  if (actor.mustChangePassword)
    throw new ForbiddenException(
      'Change your temporary password before accessing the dashboard.',
    );
  if (requiredRole && actor.role !== requiredRole)
    throw new ForbiddenException('Administrator access is required.');
}

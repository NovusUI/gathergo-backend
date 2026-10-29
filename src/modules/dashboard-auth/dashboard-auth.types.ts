import { Prisma } from '@prisma/client';
import type { Request } from 'express';

export const dashboardUserSelect = {
  id: true,
  username: true,
  fullName: true,
  role: true,
  status: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} satisfies Prisma.DashboardUserSelect;

export type DashboardUserView = Prisma.DashboardUserGetPayload<{
  select: typeof dashboardUserSelect;
}>;
export type DashboardActor = Pick<
  DashboardUserView,
  'id' | 'role' | 'status' | 'mustChangePassword'
>;
export type DashboardSessionContext = {
  id: string;
  expiresAt: Date;
  user: DashboardUserView;
};
export type DashboardRequest = Request & { dashboard: DashboardSessionContext };
export type DashboardAccessMode = 'read' | 'admin' | 'password';
export const DASHBOARD_ACCESS = 'dashboard_access';

export const DASHBOARD_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const DASHBOARD_BCRYPT_ROUNDS = 12;

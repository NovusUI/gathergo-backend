import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Test } from '@nestjs/testing';
import { DashboardAccountStatus, DashboardRole } from '@prisma/client';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAccess } from './dashboard-access';
import type {
  DashboardRequest,
  DashboardSessionContext,
} from './dashboard-auth.types';

class ProtectedController {
  @DashboardAccess('read') read() {}
  @DashboardAccess('admin') write() {}
  @DashboardAccess('password') password() {}
}
const token = 'a'.repeat(64);
describe('DashboardAuthGuard', () => {
  let guard: DashboardAuthGuard;
  const authenticate = jest.fn();
  const session: DashboardSessionContext = {
    id: 'session',
    expiresAt: new Date(Date.now() + 3600000),
    user: {
      id: 'reader',
      username: 'reader',
      fullName: 'Reader',
      role: DashboardRole.USER,
      status: DashboardAccountStatus.ACTIVE,
      mustChangePassword: false,
      createdById: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  beforeEach(async () => {
    authenticate.mockReset().mockResolvedValue(session);
    const module = await Test.createTestingModule({
      providers: [
        DashboardAuthGuard,
        Reflector,
        { provide: DashboardAuthService, useValue: { authenticate } },
      ],
    }).compile();
    guard = module.get(DashboardAuthGuard);
  });
  function context(
    method: keyof ProtectedController,
    headers: Record<string, string> = { authorization: `Bearer ${token}` },
  ) {
    return new ExecutionContextHost(
      [{ headers }, { setHeader: jest.fn() }],
      ProtectedController,
      ProtectedController.prototype[method],
    );
  }
  it('rejects an ops key, app JWT or malformed token before looking up a session', async () => {
    const headersToReject: Record<string, string>[] = [
      { 'x-ops-key': 'old-key' },
      { authorization: 'Bearer eyJ.app.jwt' },
      { authorization: `Basic ${token}` },
      {},
    ];
    for (const headers of headersToReject) {
      await expect(guard.canActivate(context('read', headers))).rejects.toThrow(
        UnauthorizedException,
      );
    }
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('allows users to read and attaches the verified server-side account', async () => {
    const ctx = context('read');
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(ctx.switchToHttp().getRequest<DashboardRequest>().dashboard).toBe(
      session,
    );
    expect(
      ctx
        .switchToHttp()
        .getResponse<{ setHeader: jest.Mock<void, [string, string]> }>()
        .setHeader,
    ).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
  it('denies user mutations and allows admins', async () => {
    await expect(guard.canActivate(context('write'))).rejects.toThrow(
      ForbiddenException,
    );
    authenticate.mockResolvedValue({
      ...session,
      user: { ...session.user, role: DashboardRole.ADMIN },
    });
    expect(await guard.canActivate(context('write'))).toBe(true);
  });
  it('requires temporary passwords to change before read/write, while allowing password/logout routes', async () => {
    authenticate.mockResolvedValue({
      ...session,
      user: { ...session.user, mustChangePassword: true },
    });
    await expect(guard.canActivate(context('read'))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(context('write'))).rejects.toThrow(
      ForbiddenException,
    );
    expect(await guard.canActivate(context('password'))).toBe(true);
  });
});

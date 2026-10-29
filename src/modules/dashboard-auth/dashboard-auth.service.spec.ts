import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DashboardAccountStatus, DashboardRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardUsersQueryDto } from './dashboard-auth.dto';
import { dashboardUserSelect } from './dashboard-auth.types';
import type {
  DashboardSessionContext,
  DashboardUserView,
} from './dashboard-auth.types';

const password = 'Synthetic-old-password!';
const account: DashboardUserView = {
  id: 'admin-1',
  username: 'ops.admin',
  fullName: 'Operations Admin',
  role: DashboardRole.ADMIN,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const session: DashboardSessionContext = {
  id: 'session-1',
  expiresAt: new Date(Date.now() + 3600000),
  user: account,
};
function database() {
  const tx = {
    dashboardUser: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn<
        Promise<DashboardUserView>,
        [Prisma.DashboardUserCreateArgs]
      >(),
      update: jest.fn<
        Promise<DashboardUserView>,
        [Prisma.DashboardUserUpdateArgs]
      >(),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.DashboardUserUpdateManyArgs]
      >(),
    },
    dashboardSession: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  return {
    ...tx,
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
}

describe('DashboardAuthService', () => {
  let prisma: ReturnType<typeof database>;
  let service: DashboardAuthService;
  let passwordHash: string;
  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 12);
  });
  beforeEach(async () => {
    prisma = database();
    prisma.dashboardUser.findUnique.mockResolvedValue({
      ...account,
      passwordHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    prisma.dashboardUser.findUniqueOrThrow.mockResolvedValue(account);
    prisma.dashboardUser.updateMany.mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        DashboardAuthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(DashboardAuthService);
  });
  it('signs in with bcrypt and stores only the hash of a random session token', async () => {
    const result = await service.login({
      username: account.username,
      password,
    });
    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      7 * 3600000,
    );
    expect(prisma.dashboardSession.create).toHaveBeenCalledWith({
      data: {
        userId: account.id,
        tokenHash: createHash('sha256').update(result.token).digest('hex'),
        expiresAt: result.expiresAt,
      },
    });
    expect(result.user).toEqual(account);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(prisma.dashboardUser.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: account.id },
      select: dashboardUserSelect,
    });
  });
  it('uses generic errors for wrong credentials and locks after five persisted failures', async () => {
    prisma.dashboardUser.findUniqueOrThrow.mockResolvedValue({
      failedLoginAttempts: 5,
    });
    await expect(
      service.login({ username: account.username, password: 'wrong' }),
    ).rejects.toThrow(
      new UnauthorizedException('Invalid username or password.'),
    );
    expect(prisma.dashboardUser.update.mock.calls[0][0].where).toEqual({
      id: account.id,
    });
    expect(
      prisma.dashboardUser.update.mock.calls[0][0].data.lockedUntil,
    ).toBeInstanceOf(Date);
    expect(prisma.dashboardSession.create).not.toHaveBeenCalled();
  });
  it.each(['missing', 'disabled', 'locked'])(
    'does not issue a session for a %s account',
    async (state) => {
      prisma.dashboardUser.findUnique.mockResolvedValue(
        state === 'missing'
          ? null
          : {
              ...account,
              passwordHash,
              failedLoginAttempts: 5,
              status:
                state === 'disabled'
                  ? DashboardAccountStatus.DISABLED
                  : DashboardAccountStatus.ACTIVE,
              lockedUntil:
                state === 'locked' ? new Date(Date.now() + 60000) : null,
            },
      );
      await expect(
        service.login({ username: account.username, password }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.dashboardSession.create).not.toHaveBeenCalled();
    },
  );
  it('does not issue a session if credentials changed during password verification', async () => {
    prisma.dashboardUser.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.login({ username: account.username, password }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.dashboardSession.create).not.toHaveBeenCalled();
  });
  it('rejects missing, expired or disabled sessions on every request', async () => {
    for (const value of [
      null,
      { ...session, expiresAt: new Date(0) },
      {
        ...session,
        user: { ...account, status: DashboardAccountStatus.DISABLED },
      },
    ]) {
      prisma.dashboardSession.findUnique.mockResolvedValue(value);
      await expect(service.authenticate('a'.repeat(64))).rejects.toThrow(
        UnauthorizedException,
      );
    }
    prisma.dashboardSession.findUnique.mockResolvedValue(session);
    expect(await service.authenticate('a'.repeat(64))).toEqual(session);
  });
  it('revokes the current session on logout', async () => {
    await service.logout(session);
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({
      where: { id: session.id },
    });
  });
  it('changes a temporary password and revokes other sessions', async () => {
    const next = 'Synthetic-new-password!';
    const result = await service.changePassword(session, {
      currentPassword: password,
      password: next,
    });
    const call = prisma.dashboardUser.updateMany.mock.calls[0][0];
    const hash = call.data.passwordHash;
    if (typeof hash !== 'string')
      throw new Error('Expected a bcrypt password hash.');
    expect(await bcrypt.compare(next, hash)).toBe(true);
    expect(call.data.mustChangePassword).toBe(false);
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: account.id, id: { not: session.id } },
    });
    expect(result).toEqual({ user: account });
  });
  it('rejects incorrect or unchanged current passwords without revoking the current session', async () => {
    await expect(
      service.changePassword(session, {
        currentPassword: 'wrong',
        password: 'Synthetic-new-password!',
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.changePassword(session, { currentPassword: password, password }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.dashboardSession.deleteMany).not.toHaveBeenCalled();
  });
  it('blocks regular users from every account management operation', async () => {
    const user = { ...account, role: DashboardRole.USER };
    await expect(
      service.listUsers(new DashboardUsersQueryDto(), user),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.createUser(
        {
          username: 'reader',
          fullName: 'Reader',
          role: DashboardRole.USER,
          password,
        },
        user,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.updateUser('another', { role: DashboardRole.ADMIN }, user),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.resetPassword('another', { password }, user),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.dashboardUser.create).not.toHaveBeenCalled();
  });
  it('creates accounts with bcrypt, a forced password change and a recorded creator', async () => {
    prisma.dashboardUser.create.mockResolvedValue(account);
    await service.createUser(
      {
        username: 'reader',
        fullName: 'Reader',
        role: DashboardRole.USER,
        password,
      },
      account,
    );
    const call = prisma.dashboardUser.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      username: 'reader',
      role: DashboardRole.USER,
      mustChangePassword: true,
      createdById: account.id,
    });
    const hash = call.data.passwordHash;
    if (typeof hash !== 'string')
      throw new Error('Expected a bcrypt password hash.');
    expect(await bcrypt.compare(password, hash)).toBe(true);
    expect(call.select).toEqual(dashboardUserSelect);
  });
  it('forbids self-demotion, self-disable and administrator self-reset', async () => {
    await expect(
      service.updateUser(account.id, { role: DashboardRole.USER }, account),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateUser(
        account.id,
        { status: DashboardAccountStatus.DISABLED },
        account,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.resetPassword(account.id, { password }, account),
    ).rejects.toThrow(BadRequestException);
  });
  it('protects the last active admin with a serializable transaction', async () => {
    prisma.dashboardUser.findUnique.mockResolvedValue({
      ...account,
      id: 'other',
    });
    prisma.dashboardUser.count.mockResolvedValue(1);
    await expect(
      service.updateUser('other', { role: DashboardRole.USER }, account),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.dashboardUser.update).not.toHaveBeenCalled();
  });
  it('revokes all sessions after role/status changes and password resets', async () => {
    prisma.dashboardUser.findUnique.mockResolvedValue({
      ...account,
      id: 'other',
      role: DashboardRole.USER,
    });
    await service.updateUser(
      'other',
      { status: DashboardAccountStatus.DISABLED },
      account,
    );
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'other' },
    });
    prisma.dashboardSession.deleteMany.mockClear();
    await service.resetPassword(
      'other',
      { password: 'Synthetic-reset-password!' },
      account,
    );
    expect(
      prisma.dashboardUser.update.mock.calls.at(-1)![0].data,
    ).toMatchObject({
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
    expect(prisma.dashboardSession.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'other' },
    });
  });
});

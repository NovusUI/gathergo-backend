import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DashboardAccountStatus, DashboardRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertDashboardAccess } from './dashboard-auth.policy';
import {
  ChangeDashboardPasswordDto,
  CreateDashboardUserDto,
  DashboardLoginDto,
  DashboardPasswordDto,
  DashboardUsersQueryDto,
  UpdateDashboardUserDto,
} from './dashboard-auth.dto';
import {
  DASHBOARD_BCRYPT_ROUNDS,
  DASHBOARD_SESSION_LIFETIME_MS,
  dashboardUserSelect,
} from './dashboard-auth.types';
import type {
  DashboardActor,
  DashboardSessionContext,
} from './dashboard-auth.types';

// Missing usernames perform the same bcrypt work as existing accounts.
const DUMMY_PASSWORD_HASH =
  '$2b$12$fEHqY.EUm0O7PO3dGsEBhexmERd9TeJE/318QWg23ykc/yEyydD2C';

@Injectable()
export class DashboardAuthService {
  constructor(private readonly prisma: PrismaService) {}

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(dto: DashboardLoginDto) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { username: dto.username },
    });
    const matches = await bcrypt.compare(
      dto.password,
      user ? user.passwordHash : DUMMY_PASSWORD_HASH,
    );
    const now = new Date();
    if (
      !user ||
      !matches ||
      user.status !== DashboardAccountStatus.ACTIVE ||
      (user.lockedUntil !== null && user.lockedUntil > now)
    ) {
      if (user && !matches && user.status === DashboardAccountStatus.ACTIVE) {
        await this.prisma.$transaction(async (tx) => {
          const attempt = await tx.dashboardUser.updateMany({
            where: {
              id: user.id,
              passwordHash: user.passwordHash,
              status: DashboardAccountStatus.ACTIVE,
              OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
            },
            data: { failedLoginAttempts: { increment: 1 } },
          });
          if (attempt.count) {
            const state = await tx.dashboardUser.findUniqueOrThrow({
              where: { id: user.id },
              select: { failedLoginAttempts: true },
            });
            if (state.failedLoginAttempts >= 5)
              await tx.dashboardUser.update({
                where: { id: user.id },
                data: { lockedUntil: new Date(now.getTime() + 15 * 60 * 1000) },
              });
          }
        });
      }
      throw new UnauthorizedException('Invalid username or password.');
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + DASHBOARD_SESSION_LIFETIME_MS);
    const account = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.dashboardUser.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          status: DashboardAccountStatus.ACTIVE,
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
      if (claimed.count !== 1)
        throw new UnauthorizedException('Invalid username or password.');
      await tx.dashboardSession.deleteMany({
        where: { userId: user.id, expiresAt: { lte: now } },
      });
      await tx.dashboardSession.create({
        data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
      });
      return tx.dashboardUser.findUniqueOrThrow({
        where: { id: user.id },
        select: dashboardUserSelect,
      });
    });
    return { token, expiresAt, user: account };
  }

  async authenticate(token: string): Promise<DashboardSessionContext> {
    const session = await this.prisma.dashboardSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        user: { select: dashboardUserSelect },
      },
    });
    if (
      !session ||
      session.expiresAt <= new Date() ||
      session.user.status !== DashboardAccountStatus.ACTIVE
    )
      throw new UnauthorizedException(
        'Your dashboard session has expired. Sign in again.',
      );
    return session;
  }

  async logout(session: DashboardSessionContext) {
    await this.prisma.dashboardSession.deleteMany({
      where: { id: session.id },
    });
    return { signedOut: true };
  }

  async changePassword(
    session: DashboardSessionContext,
    dto: ChangeDashboardPasswordDto,
  ) {
    const user = await this.prisma.dashboardUser.findUnique({
      where: { id: session.user.id },
    });
    if (
      !user ||
      !(await bcrypt.compare(dto.currentPassword, user.passwordHash))
    )
      throw new BadRequestException('The current password is incorrect.');
    if (dto.password === dto.currentPassword)
      throw new BadRequestException('Choose a different new password.');
    const passwordHash = await bcrypt.hash(
      dto.password,
      DASHBOARD_BCRYPT_ROUNDS,
    );
    const account = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.dashboardUser.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          status: DashboardAccountStatus.ACTIVE,
        },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          'The account changed. Sign in again before changing its password.',
        );
      await tx.dashboardSession.deleteMany({
        where: { userId: user.id, id: { not: session.id } },
      });
      return tx.dashboardUser.findUniqueOrThrow({
        where: { id: user.id },
        select: dashboardUserSelect,
      });
    });
    return { user: account };
  }

  async listUsers(dto: DashboardUsersQueryDto, actor: DashboardActor) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    const search = dto.search?.trim();
    const where: Prisma.DashboardUserWhereInput = search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { fullName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      this.prisma.dashboardUser.findMany({
        where,
        select: dashboardUserSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.dashboardUser.count({ where }),
    ]);
    return { data, total, page: dto.page, pageSize: dto.pageSize };
  }

  async createUser(dto: CreateDashboardUserDto, actor: DashboardActor) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    const passwordHash = await bcrypt.hash(
      dto.password,
      DASHBOARD_BCRYPT_ROUNDS,
    );
    return this.prisma.dashboardUser
      .create({
        data: {
          username: dto.username,
          fullName: dto.fullName,
          role: dto.role,
          passwordHash,
          createdById: actor.id,
          mustChangePassword: true,
        },
        select: dashboardUserSelect,
      })
      .catch((error: unknown) => this.rethrowWriteError(error));
  }

  async updateUser(
    id: string,
    dto: UpdateDashboardUserDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    if (
      id === actor.id &&
      ((dto.role !== undefined && dto.role !== actor.role) ||
        (dto.status !== undefined &&
          dto.status !== DashboardAccountStatus.ACTIVE))
    )
      throw new BadRequestException(
        'You cannot change your own role or disable your own account.',
      );
    return this.prisma
      .$transaction(
        async (tx) => {
          const target = await tx.dashboardUser.findUnique({ where: { id } });
          if (!target)
            throw new NotFoundException('Dashboard account not found.');
          if (
            target.role === DashboardRole.ADMIN &&
            target.status === DashboardAccountStatus.ACTIVE &&
            (dto.role === DashboardRole.USER ||
              dto.status === DashboardAccountStatus.DISABLED)
          ) {
            const adminCount = await tx.dashboardUser.count({
              where: {
                role: DashboardRole.ADMIN,
                status: DashboardAccountStatus.ACTIVE,
              },
            });
            if (adminCount <= 1)
              throw new ConflictException(
                'At least one active administrator must remain.',
              );
          }
          const account = await tx.dashboardUser.update({
            where: { id },
            data: {
              ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
              ...(dto.role !== undefined ? { role: dto.role } : {}),
              ...(dto.status !== undefined ? { status: dto.status } : {}),
            },
            select: dashboardUserSelect,
          });
          if (
            (dto.role !== undefined && dto.role !== target.role) ||
            (dto.status !== undefined && dto.status !== target.status)
          )
            await tx.dashboardSession.deleteMany({ where: { userId: id } });
          return account;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => this.rethrowWriteError(error));
  }

  async resetPassword(
    id: string,
    dto: DashboardPasswordDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    if (id === actor.id)
      throw new BadRequestException(
        'Use Change password to update your own password.',
      );
    const passwordHash = await bcrypt.hash(
      dto.password,
      DASHBOARD_BCRYPT_ROUNDS,
    );
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.dashboardUser.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!target) throw new NotFoundException('Dashboard account not found.');
      const account = await tx.dashboardUser.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
        select: dashboardUserSelect,
      });
      await tx.dashboardSession.deleteMany({ where: { userId: id } });
      return account;
    });
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        throw new ConflictException(
          'That dashboard username is already in use.',
        );
      if (error.code === 'P2034')
        throw new ConflictException(
          'An account changed at the same time. Reload and try again.',
        );
    }
    throw error;
  }
}

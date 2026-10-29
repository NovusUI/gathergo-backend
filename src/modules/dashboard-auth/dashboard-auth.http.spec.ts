import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DashboardAccountStatus, DashboardRole } from '@prisma/client';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { CarpoolController } from '../carpool/carpool.controller';
import { CarpoolService } from '../carpool/carpool.service';
import { DashboardController } from '../dashboard/controllers/dashboard.controller';
import { DashboardService } from '../dashboard/services/dashboard.service';
import { TransactionReferenceController } from '../transaction-reference/transaction-reference.controller';
import { TransactionReferenceService } from '../transaction-reference/transaction-reference.service';
import { WalletController } from '../wallet/controller/wallet.controller';
import { WalletService } from '../wallet/service/wallet.service';
import { DashboardAuthController } from './dashboard-auth.controller';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { DashboardAuthService } from './dashboard-auth.service';
import type { DashboardSessionContext } from './dashboard-auth.types';
import { DashboardUsersController } from './dashboard-users.controller';

const reader = 'a'.repeat(64);
const admin = 'b'.repeat(64);
const temporary = 'c'.repeat(64);
const user: DashboardSessionContext['user'] = {
  id: 'reader',
  username: 'reader',
  fullName: 'Reader',
  role: DashboardRole.USER,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
  createdById: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const expiresAt = new Date(Date.now() + 3600000);
const login = jest.fn().mockResolvedValue({ user, token: reader, expiresAt });
const listUsers = jest
  .fn()
  .mockResolvedValue({ data: [user], page: 1, pageSize: 20, total: 1 });
const createUser = jest.fn().mockResolvedValue(user);
const getPaginatedEventCarpools = jest
  .fn()
  .mockResolvedValue({ data: [], page: 1, pageSize: 20, total: 0 });
const writes = [
  '/wallet/internal/kyc/creator/review',
  '/wallet/internal/payout-profile/creator/review',
  '/wallet/internal/alat-profile/creator',
  '/wallet/internal/settlements/creator',
  '/wallet/internal/settlements/record/complete',
  '/transaction-reference/internal/risk-reviews',
  '/transaction-reference/internal/payment/risk-review',
  '/transaction-reference/internal/payment/refund-confirmation',
  '/dashboard/users',
  '/dashboard/users/account/password',
];

describe('Dashboard HTTP access and response contracts', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        DashboardAuthController,
        DashboardUsersController,
        WalletController,
        TransactionReferenceController,
        DashboardController,
        CarpoolController,
      ],
      providers: [
        Reflector,
        RateLimitGuard,
        DashboardAuthGuard,
        {
          provide: DashboardAuthService,
          useValue: {
            login,
            listUsers,
            createUser,
            authenticate: (token: string): DashboardSessionContext => ({
              id: 'session',
              expiresAt,
              user: {
                ...user,
                role:
                  token === admin ? DashboardRole.ADMIN : DashboardRole.USER,
                mustChangePassword: token === temporary,
              },
            }),
            logout: () => ({ signedOut: true }),
            changePassword: () => ({ user }),
          },
        },
        { provide: WalletService, useValue: {} },
        { provide: TransactionReferenceService, useValue: {} },
        {
          provide: DashboardService,
          useValue: { getInternalOverview: () => ({ counts: 'synthetic' }) },
        },
        { provide: CarpoolService, useValue: { getPaginatedEventCarpools } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(new JwtAuthGuard(module.get(Reflector)));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  it('allows public login, validates credentials and wraps the safe session response', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/dashboard/auth/login')
      .send({ username: ' READER ', password: 'Synthetic-password!' })
      .expect(201)
      .expect('Cache-Control', 'no-store')
      .expect({
        status: 'success',
        message: 'Request successful',
        data: {
          user: {
            ...user,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          },
          token: reader,
          expiresAt: expiresAt.toISOString(),
        },
      });
    expect(login).toHaveBeenCalledWith({
      username: 'reader',
      password: 'Synthetic-password!',
    });
    await request(app.getHttpServer())
      .post('/api/v1/dashboard/auth/login')
      .send({ username: 'reader', password: 123456789012 })
      .expect(400);
  });
  it('rejects legacy ops keys and app JWTs at real internal routes', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/overview')
      .set('x-ops-key', 'retired-key')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/overview')
      .set('Authorization', 'Bearer eyJ.app.jwt')
      .expect(401);
  });
  it.each(writes)(
    'rejects read-only users at POST %s before processing a mutation',
    async (path) => {
      await request(app.getHttpServer())
        .post(`/api/v1${path}`)
        .set('Authorization', `Bearer ${reader}`)
        .send({})
        .expect(403);
    },
  );
  it('rejects read-only account edits and account listing', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/dashboard/users/account')
      .set('Authorization', `Bearer ${reader}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/users')
      .set('Authorization', `Bearer ${reader}`)
      .expect(403);
    expect(createUser).not.toHaveBeenCalled();
  });
  it('allows read-only overview and staff carpool inspection', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/overview')
      .set('Authorization', `Bearer ${reader}`)
      .expect(200)
      .expect({
        status: 'success',
        message: 'Request successful',
        data: { counts: 'synthetic' },
      });
    await request(app.getHttpServer())
      .get('/api/v1/carpool/internal/event/event-id/paginated')
      .set('Authorization', `Bearer ${reader}`)
      .expect(200);
    expect(getPaginatedEventCarpools).toHaveBeenCalledWith(
      null,
      'event-id',
      expect.any(Object),
    );
  });
  it('preserves the account-list pagination envelope for admins', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/users')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200)
      .expect({
        status: 'success',
        message: 'Request successful',
        data: [
          {
            ...user,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
          },
        ],
        meta: { page: 1, pageSize: 20, total: 1, hasNextPage: false },
      });
  });
  it('allows temporary sessions only to inspect their identity, change password and log out', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/overview')
      .set('Authorization', `Bearer ${temporary}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/auth/me')
      .set('Authorization', `Bearer ${temporary}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/dashboard/auth/password')
      .set('Authorization', `Bearer ${temporary}`)
      .send({
        currentPassword: 'Synthetic-password!',
        password: 'Synthetic-new-password!',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/dashboard/auth/logout')
      .set('Authorization', `Bearer ${temporary}`)
      .send({})
      .expect(201);
  });
});

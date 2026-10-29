import 'reflect-metadata';
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DashboardAccountStatus, DashboardRole } from '@prisma/client';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { DashboardAuthGuard } from 'src/modules/dashboard-auth/dashboard-auth.guard';
import { DashboardAuthService } from 'src/modules/dashboard-auth/dashboard-auth.service';
import type { DashboardSessionContext } from 'src/modules/dashboard-auth/dashboard-auth.types';
import type { CreatorProfile } from '../creator.types';
import { CreatorsService } from '../services/creators.service';
import { CreatorsController } from './creators.controller';

const reader = 'a'.repeat(64),
  admin = 'b'.repeat(64),
  temporary = 'c'.repeat(64);
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
const creator: CreatorProfile = {
  id: 'creator-1',
  username: 'host',
  fullName: 'Host',
  email: 'host@example.test',
  isVerified: true,
  createdAt: new Date('2026-10-27T10:00:00Z'),
  _count: { eventsCreated: 1, followedBy: 2 },
  settlementProfile: null,
  kycVerification: null,
  alatProfile: null,
  bio: null,
  phoneNumber: null,
};
const list = jest.fn().mockResolvedValue({
  data: [creator],
  total: 1,
  page: 1,
  pageSize: 20,
  summary: {
    eventCreatorCount: 1,
    verifiedKycCount: 0,
    payoutActiveCount: 0,
  },
});
const detail = jest.fn().mockResolvedValue({
  creator,
  recentEvents: [],
  liveUpcomingEvents: 0,
  payments: {
    successfulCount: 0,
    grossAmountKobo: 0,
    creatorPayableKobo: 0,
    settledAmountKobo: 0,
  },
  evaluatedAt: new Date('2026-10-27T10:00:00Z'),
});

describe('Creator dashboard HTTP contracts', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CreatorsController],
      providers: [
        Reflector,
        DashboardAuthGuard,
        {
          provide: DashboardAuthService,
          useValue: {
            authenticate: (token: string): DashboardSessionContext => {
              if (![reader, admin, temporary].includes(token))
                throw new UnauthorizedException();
              return {
                id: 'session',
                expiresAt: new Date(Date.now() + 3600000),
                user: {
                  ...user,
                  role:
                    token === admin ? DashboardRole.ADMIN : DashboardRole.USER,
                  mustChangePassword: token === temporary,
                },
              };
            },
          },
        },
        { provide: CreatorsService, useValue: { list, detail } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
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
  it('rejects unauthenticated and legacy-key requests', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators/creator-1')
      .set('x-ops-key', 'retired')
      .expect(401);
  });
  it.each([reader, admin])(
    'allows the staff role to inspect creators with a session token',
    async (token) => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/internal/creators?search=Host')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect('Cache-Control', 'no-store');
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/internal/creators/creator-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    },
  );
  it('preserves pagination and filter summary inside the data envelope', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators')
      .set('Authorization', `Bearer ${reader}`)
      .expect(200)
      .expect({
        status: 'success',
        message: 'Request successful',
        data: {
          data: [{ ...creator, createdAt: creator.createdAt.toISOString() }],
          total: 1,
          page: 1,
          pageSize: 20,
          summary: {
            eventCreatorCount: 1,
            verifiedKycCount: 0,
            payoutActiveCount: 0,
          },
        },
      });
  });
  it('blocks temporary-password sessions and invalid filters', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators')
      .set('Authorization', `Bearer ${temporary}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators?pageSize=100')
      .set('Authorization', `Bearer ${reader}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/creators?kycStatus=BAD')
      .set('Authorization', `Bearer ${reader}`)
      .expect(400);
  });
});

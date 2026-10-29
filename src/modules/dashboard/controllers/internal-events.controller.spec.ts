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
import { InternalEventsService } from '../services/internal-events.service';
import { InternalEventsController } from './internal-events.controller';

const reader = 'a'.repeat(64),
  admin = 'b'.repeat(64);
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
const queue = {
  data: [],
  total: 28,
  page: 2,
  pageSize: 20,
  summary: { upcomingCount: 12, liveCount: 3, endedCount: 13 },
};
const list = jest.fn().mockResolvedValue(queue);
const detail = jest.fn().mockResolvedValue({ id: 'event-1' });
const update = jest.fn().mockResolvedValue({ id: 'event-1', title: 'Edited' });

describe('Platform events HTTP contracts', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InternalEventsController],
      providers: [
        Reflector,
        DashboardAuthGuard,
        {
          provide: DashboardAuthService,
          useValue: {
            authenticate: (token: string): DashboardSessionContext => {
              if (![reader, admin].includes(token))
                throw new UnauthorizedException();
              return {
                id: 'session',
                expiresAt: new Date(Date.now() + 3600000),
                user: {
                  ...user,
                  role:
                    token === admin ? DashboardRole.ADMIN : DashboardRole.USER,
                },
              };
            },
          },
        },
        { provide: InternalEventsService, useValue: { list, detail, update } },
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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('requires a dashboard session', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/events')
      .expect(401);
  });
  it.each([reader, admin])(
    'allows staff reads with pagination and summaries inside the data envelope',
    async (token) => {
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/internal/events?page=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect('Cache-Control', 'no-store')
        .expect({
          status: 'success',
          message: 'Request successful',
          data: queue,
        });
      await request(app.getHttpServer())
        .get('/api/v1/dashboard/internal/events/event-1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 }),
        expect.objectContaining({
          role: token === admin ? DashboardRole.ADMIN : DashboardRole.USER,
        }),
      );
    },
  );
  it('blocks read-only users from edits', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/dashboard/internal/events/event-1')
      .set('Authorization', `Bearer ${reader}`)
      .send({ expectedUpdatedAt: '2020-01-01T00:00:00Z', title: 'Edited' })
      .expect(403);
    expect(update).not.toHaveBeenCalled();
  });
  it('allows admins to edit historical details with existing link and boolean normalization', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/dashboard/internal/events/event-1')
      .set('Authorization', `Bearer ${admin}`)
      .send({
        expectedUpdatedAt: '2020-01-01T00:00:00Z',
        title: ' Edited ',
        isPhysicalEvent: false,
        links: ['example.com'],
        startDate: '2020-01-01T00:00:00Z',
      })
      .expect(200);
    expect(update).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({
        title: 'Edited',
        isPhysicalEvent: false,
        links: ['https://example.com'],
        startDate: '2020-01-01T00:00:00Z',
      }),
      expect.objectContaining({ role: DashboardRole.ADMIN }),
    );
  });
  it('rejects invalid filters and immutable fields instead of silently stripping them', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/dashboard/internal/events?status=BAD')
      .set('Authorization', `Bearer ${reader}`)
      .expect(400);
    for (const body of [
      { title: 'Missing version' },
      { expectedUpdatedAt: '2020-01-01T00:00:00Z', creatorId: 'another-owner' },
      {
        expectedUpdatedAt: '2020-01-01T00:00:00Z',
        registrationType: 'donation',
      },
    ]) {
      await request(app.getHttpServer())
        .patch('/api/v1/dashboard/internal/events/event-1')
        .set('Authorization', `Bearer ${admin}`)
        .send(body)
        .expect(400);
    }
    expect(update).not.toHaveBeenCalled();
  });
});

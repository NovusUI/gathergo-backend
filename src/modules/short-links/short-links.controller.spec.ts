import {
  ExecutionContext,
  INestApplication,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ShortLinkKind } from '@prisma/client';
import type { Request } from 'express';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { IS_PUBLIC_KEY } from 'src/common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import {
  ShortLinksController,
  ShortLinkRedirectController,
} from './short-links.controller';
import { ShortLinksService } from './short-links.service';

const targetId = '00000000-0000-4000-8000-000000000001';
const createdAt = new Date('2026-10-27T12:00:00Z');
const link = {
  code: '8nQ4xK2p',
  kind: ShortLinkKind.event,
  targetId,
  createdAt,
};
const create = jest.fn().mockResolvedValue(link);
const resolve = jest.fn().mockResolvedValue(link);

describe('Short link HTTP contracts', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const reflector = new Reflector();
    const module = await Test.createTestingModule({
      controllers: [ShortLinksController, ShortLinkRedirectController],
      providers: [
        { provide: ShortLinksService, useValue: { create, resolve } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (
            reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
              context.getHandler(),
              context.getClass(),
            ])
          )
            return true;
          if (
            context.switchToHttp().getRequest<Request>().headers
              .authorization !== 'Bearer test'
          )
            throw new UnauthorizedException();
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [{ path: 's/:code', method: RequestMethod.GET }],
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
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
    create.mockResolvedValue(link);
    resolve.mockResolvedValue(link);
  });
  it('requires authentication to create a link', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/share-links')
      .send({ kind: 'event', targetId })
      .expect(401);
    expect(create).not.toHaveBeenCalled();
  });
  it('returns the inspected app response envelope for a creation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/share-links')
      .set('Authorization', 'Bearer test')
      .send({ kind: 'event', targetId })
      .expect(201)
      .expect({
        status: 'success',
        message: 'Request successful',
        data: { ...link, createdAt: createdAt.toISOString() },
      });
    expect(create).toHaveBeenCalledWith({ kind: 'event', targetId });
  });
  it.each([
    { kind: 'event', targetId: 'https://evil.example' },
    { kind: 'url', targetId },
    { kind: 'event', targetId, url: 'https://evil.example' },
  ])(
    'rejects arbitrary destinations and undocumented fields %j',
    async (body) => {
      await request(app.getHttpServer())
        .post('/api/v1/share-links')
        .set('Authorization', 'Bearer test')
        .send(body)
        .expect(400);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('resolves a code without a login token', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/share-links/${link.code}`)
      .expect(200)
      .expect({
        status: 'success',
        message: 'Request successful',
        data: { ...link, createdAt: createdAt.toISOString() },
      });
  });
  it.each(['short', '123456789', 'bad!code'])(
    'rejects malformed codes before querying %s',
    async (code) => {
      await request(app.getHttpServer())
        .get(`/api/v1/share-links/${code}`)
        .expect(400);
      expect(resolve).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['event', '/event/'],
    ['foodbank', '/food-bank/'],
    ['carpool', '/carpool/'],
  ] as const)(
    'the public root route redirects %s to the matching canonical page',
    async (kind, path) => {
      resolve.mockResolvedValue({ ...link, kind });
      await request(app.getHttpServer())
        .get(`/s/${link.code}?url=https://evil.example`)
        .expect(302)
        .expect('Location', `https://gathergo.events${path}${targetId}`)
        .expect('Cache-Control', 'no-store');
    },
  );
});

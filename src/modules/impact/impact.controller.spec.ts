import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import axios, { AxiosHeaders } from 'axios';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { getJwtSecret } from 'src/config/runtime-env';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { ImpactModule } from './impact.module';

const emptyMap = {
  sdgGoals: [],
  impactPaths: [],
  commitments: [],
  source: 'ai',
};

describe('Impact suggestions API', () => {
  let app: INestApplication<App>;
  let token: string;
  let post: jest.SpyInstance<
    ReturnType<typeof axios.post>,
    Parameters<typeof axios.post>
  >;
  const findUser = jest.fn().mockResolvedValue({ id: 'impact-organiser' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ DEEPSEEK_API_KEY: 'test-deepseek-key' })],
        }),
        ImpactModule,
      ],
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: { user: { findUnique: findUser } },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
    await app.listen(0, '127.0.0.1');
    token = new JwtService().sign(
      { sub: 'impact-organiser' },
      { secret: getJwtSecret() },
    );
  });

  beforeEach(() => {
    post = jest.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: JSON.stringify({
                sdgGoals: [],
                impactPaths: [],
                commitments: [],
              }),
            },
          },
        ],
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { headers: new AxiosHeaders() },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  it('requires authentication before making a paid model request', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/impact/suggestions')
      .send({ impactDescription: 'Plant trees with neighbours.' })
      .expect(401);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns the existing response envelope with AI-sourced suggestions', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/impact/suggestions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'An evening together',
        impactDescription: 'Enjoy music with neighbours.',
      })
      .expect(201, {
        status: 'success',
        message: 'Request successful',
        data: emptyMap,
      });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid draft fields before calling DeepSeek', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/impact/suggestions')
      .set('Authorization', `Bearer ${token}`)
      .send({ impactDescription: 'a'.repeat(601) })
      .expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('rate limits model requests using the existing guard', async () => {
    for (let index = 0; index < 30; index += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/impact/suggestions')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', '192.0.2.80')
        .send({ impactDescription: 'Enjoy music with neighbours.' })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/api/v1/impact/suggestions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', '192.0.2.80')
      .send({ impactDescription: 'Enjoy music with neighbours.' })
      .expect(429);
    expect(post).toHaveBeenCalledTimes(30);
  });
});

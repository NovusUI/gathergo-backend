import { EventFeedbackController } from './event-feedback.controller';
import { EventFeedbackService } from './event-feedback.service';
import type { UpdatePreferenceDto } from './dto/update-preference.dto';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Event, User } from '@prisma/client';
import type { Server } from 'http';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptors';
import { PrismaService } from '../../prisma/prisma.service';
import { CarpoolQueueService } from '../../queue/carpool/queue.service';
import { EventService } from '../event/event.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { MediaService } from '../media/media.service';
import { UserPreferenceController } from './user-preference.controller';
import { UserPreferenceService } from './user-preference.service';

const url = process.env.INTEREST_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Interest map API and persisted feed ranking', () => {
  let prisma: PrismaService;
  let app: INestApplication<Server>;
  let feed: EventService;
  let preferences: UserPreferenceService;
  let user: User;
  let creator: User;
  let nature: Event;
  let education: Event;
  let authenticated = true;
  const payload: UpdatePreferenceDto = {
    interests: ['Nature'],
    helpModes: ['volunteer'],
    city: 'Lagos',
    learningEnabled: true,
    likedEventIds: [],
  };
  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).searchParams.get('schema')?.startsWith('interest_map_test_')
    )
      throw new Error('Use an isolated local interest_map_test_ schema.');
    prisma = new PrismaService({ datasources: { db: { url } } });
    const module = await Test.createTestingModule({
      controllers: [UserPreferenceController, EventFeedbackController],
      providers: [
        UserPreferenceService,
        EventFeedbackService,
        EventService,
        { provide: PrismaService, useValue: prisma },
        { provide: CarpoolQueueService, useValue: {} },
        { provide: EventTicketService, useValue: {} },
        { provide: MediaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest<{ user: { id: string } }>().user = {
            id: user.id,
          };
          return authenticated;
        },
      })
      .compile();
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
    feed = module.get(EventService);
    preferences = module.get(UserPreferenceService);
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    authenticated = true;
    await prisma.user.deleteMany();
    user = await prisma.user.create({
      data: { email: 'reader@interest.test', isProfileComplete: true },
    });
    creator = await prisma.user.create({
      data: { email: 'creator@interest.test' },
    });
    const base = {
      creatorId: creator.id,
      description: 'An upcoming local event.',
      location: 'Lagos',
      links: [],
      startDate: new Date('2035-02-03T09:00:00Z'),
      endDate: new Date('2035-02-03T11:00:00Z'),
    };
    nature = await prisma.event.create({
      data: {
        ...base,
        title: 'Plant trees',
        tags: ['Nature'],
        registrationType: 'volunteer',
        impactSdgGoals: [{ id: 'sdg_15' }],
      },
    });
    education = await prisma.event.create({
      data: {
        ...base,
        title: 'Learning day',
        tags: ['Education'],
        registrationType: 'registration',
        registrationFee: 0,
      },
    });
  });
  afterEach(async () => {
    await prisma.interestSignal.deleteMany();
    await prisma.userPreference.deleteMany();
    await prisma.registration.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.eventTicket.deleteMany();
    await prisma.donation.deleteMany();
    await prisma.transactionReference.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
  });
  const save = (body: object = payload) =>
    request(app.getHttpServer()).patch('/api/v1/preferences').send(body);

  const pendingSurvey = () =>
    request(app.getHttpServer()).get(
      '/api/v1/preferences/event-feedback/pending',
    );
  const answerSurvey = (
    body: object = { rating: 'LOVED', moreLikeThis: true },
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/preferences/event-feedback/${nature.id}`)
      .send(body);
  const prepareSurvey = async (scan = true) => {
    await save({ ...payload, learningEnabled: false }).expect(200);
    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { learningSince: new Date(Date.now() - 7 * 86400000) },
    });
    await prisma.event.update({
      where: { id: nature.id },
      data: {
        startDate: new Date(Date.now() - 2 * 86400000),
        endDate: new Date(Date.now() - 86400000),
      },
    });
    if (scan)
      await prisma.registration.create({
        data: {
          userId: user.id,
          eventId: nature.id,
          qrCode: `survey-${user.id}`,
          transactionId: 'survey-check-in',
          isUsed: true,
          status: 'used',
          scannedAt: new Date(Date.now() - 1.5 * 86400000),
        },
      });
  };
  it('only offers a recent ended event with this user’s recorded attendance', async () => {
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await prepareSurvey(false);
    await prisma.registration.create({
      data: {
        userId: user.id,
        eventId: nature.id,
        qrCode: 'not-scanned',
        transactionId: 'unscanned',
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await answerSurvey().expect(404);
    await prisma.registration.updateMany({
      where: { userId: user.id },
      data: {
        isUsed: true,
        status: 'used',
        scannedAt: new Date(Date.now() - 1.5 * 86400000),
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: { id: nature.id, title: nature.title },
    });
    await prisma.event.update({
      where: { id: nature.id },
      data: { endDate: new Date(Date.now() + 86400000) },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await answerSurvey().expect(404);
    await prisma.event.update({
      where: { id: nature.id },
      data: { endDate: new Date(Date.now() - 31 * 86400000) },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
  });
  it('learns from an explicit answer with passive learning off and keeps retries idempotent', async () => {
    await prepareSurvey();
    const result = await answerSurvey().expect(201);
    expect(result.body).toMatchObject({
      data: {
        rating: 'LOVED',
        moreLikeThis: true,
        profile: {
          learningEnabled: false,
          weights: [expect.objectContaining({ id: 'Nature', weight: 8 })],
        },
        changes: [
          expect.objectContaining({
            id: 'Nature',
            previousWeight: 5,
            weight: 8,
          }),
        ],
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await Promise.all([answerSurvey().expect(201), answerSurvey().expect(201)]);
    expect(await prisma.eventFeedback.count()).toBe(1);
    expect((await preferences.getPreferences(user.id)).weights[0].weight).toBe(
      8,
    );
    await answerSurvey({ rating: 'NOT_FOR_ME', moreLikeThis: false }).expect(
      201,
    );
    expect(
      (await preferences.getPreferences(user.id)).weights[0],
    ).toMatchObject({ id: 'Nature', weight: 3.5 });
    expect(await prisma.eventFeedback.count()).toBe(1);
  });
  it('defers for one day without changing the map and can return after the deferral', async () => {
    await prepareSurvey();
    await request(app.getHttpServer())
      .post(`/api/v1/preferences/event-feedback/${nature.id}/defer`)
      .expect(201);
    const row = await prisma.eventFeedback.findFirstOrThrow();
    expect(row.rating).toBeNull();
    expect(row.respondedAt).toBeNull();
    expect(row.deferredUntil!.getTime() - Date.now()).toBeGreaterThan(86300000);
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    expect((await preferences.getPreferences(user.id)).weights[0].weight).toBe(
      5,
    );
    await prisma.eventFeedback.update({
      where: { id: row.id },
      data: { deferredUntil: new Date(Date.now() - 1000) },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: { id: nature.id },
    });
  });
  it('validates ratings and booleans, and blocks users without attendance or authentication', async () => {
    await prepareSurvey();
    await answerSurvey({ rating: 'bad', moreLikeThis: false }).expect(400);
    await answerSurvey({ rating: 'LOVED', moreLikeThis: 'false' }).expect(400);
    await answerSurvey({ rating: 'NOT_FOR_ME', moreLikeThis: true }).expect(
      400,
    );
    await answerSurvey({ rating: 'LOVED' }).expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/preferences/event-feedback/${education.id}`)
      .send({ rating: 'LOVED', moreLikeThis: true })
      .expect(404);
    expect(await prisma.eventFeedback.count()).toBe(0);
    authenticated = false;
    await pendingSurvey().expect(403);
    await answerSurvey().expect(403);
  });
  it('also recognises ticket and volunteer check-ins', async () => {
    await prepareSurvey(false);
    const ticketType = await prisma.eventTicket.create({
      data: {
        eventId: nature.id,
        type: 'Entry',
        description: 'Entry',
        price: 0,
        quantity: 5,
        perks: [],
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        userId: user.id,
        eventTicketId: ticketType.id,
        qrCode: 'survey-ticket',
        transactionId: 'survey-ticket',
        status: 'used',
        isUsed: true,
        scannedAt: new Date(Date.now() - 1.5 * 86400000),
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: { id: nature.id },
    });
    await prisma.ticket.delete({ where: { id: ticket.id } });
    const role = await prisma.volunteerRole.create({
      data: {
        eventId: nature.id,
        title: 'Helper',
        description: 'Help',
        capacity: 1,
      },
    });
    const volunteer = await prisma.eventVolunteer.create({
      data: {
        eventId: nature.id,
        roleId: role.id,
        userId: user.id,
        status: 'ACCEPTED',
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await prisma.eventVolunteer.update({
      where: { id: volunteer.id },
      data: {
        status: 'CHECKED_IN',
        checkedInAt: new Date(Date.now() - 1.5 * 86400000),
      },
    });
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: { id: nature.id },
    });
  });
  it('clears survey learning on reset and deletion without asking about the old event again', async () => {
    await prepareSurvey();
    await answerSurvey().expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/preferences/reset-learning')
      .expect(201);
    expect(await prisma.eventFeedback.count()).toBe(0);
    expect((await preferences.getPreferences(user.id)).weights[0].weight).toBe(
      5,
    );
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { learningSince: new Date(Date.now() - 7 * 86400000) },
    });
    await answerSurvey().expect(201);
    await request(app.getHttpServer())
      .delete('/api/v1/preferences')
      .expect(200);
    expect(await prisma.eventFeedback.count()).toBe(0);
    expect((await pendingSurvey().expect(200)).body).toMatchObject({
      data: null,
    });
  });

  it('offers carpool and persists it alone or alongside every other way to join in', async () => {
    const helpModes = ['attend', 'volunteer', 'donate', 'carpool'];
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/preferences/catalog')
      .expect(200);
    expect(catalog.body).toMatchObject({ data: { helpModes } });
    for (const selection of [['carpool'], helpModes]) {
      const saved = await save({ ...payload, helpModes: selection }).expect(
        200,
      );
      expect(saved.body).toMatchObject({ data: { helpModes: selection } });
      const loaded = await request(app.getHttpServer())
        .get('/api/v1/preferences')
        .expect(200);
      expect(loaded.body).toMatchObject({ data: { helpModes: selection } });
      expect(
        (
          await prisma.userPreference.findUniqueOrThrow({
            where: { userId: user.id },
          })
        ).helpModes,
      ).toEqual(selection);
    }
  });
  it('allows fully skipped onboarding and persists the flag without inventing interests', async () => {
    const result = await save({
      interests: [],
      helpModes: [],
      city: '',
      learningEnabled: false,
      likedEventIds: [],
    }).expect(200);
    expect(result.body).toMatchObject({
      data: {
        interests: [],
        helpModes: [],
        city: null,
        learningEnabled: false,
        weights: [],
      },
    });
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .hasPreferences,
    ).toBe(true);
  });
  it('saves chosen and liked signals and uses them in the real feed', async () => {
    const response = await save({
      ...payload,
      likedEventIds: [nature.id],
    }).expect(200);
    expect(response.body).toMatchObject({
      data: {
        interests: ['Nature'],
        weights: [expect.objectContaining({ id: 'Nature', source: 'both' })],
      },
    });
    const events = await feed.getForYouEvents(user.id);
    expect(events[0]).toMatchObject({
      id: nature.id,
      reason: 'Because you chose environment',
    });
  });
  it('returns real upcoming examples only and tolerates a sparse catalogue', async () => {
    await prisma.event.update({
      where: { id: education.id },
      data: { endDate: new Date('2020-01-01') },
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/preferences/examples')
      .query({ interests: 'Nature', city: 'Lagos' })
      .expect(200);
    expect(response.body).toMatchObject({
      data: [{ id: nature.id, title: 'Plant trees', topics: ['Nature'] }],
    });
  });
  it('records a view once and treats skip as an unsupported signal', async () => {
    await save().expect(200);
    for (let i = 0; i < 2; i++)
      await request(app.getHttpServer())
        .post('/api/v1/preferences/signals')
        .send({ eventId: education.id, kind: 'VIEW' })
        .expect(201);
    expect(await prisma.interestSignal.count()).toBe(1);
    await request(app.getHttpServer())
      .post('/api/v1/preferences/signals')
      .send({ eventId: education.id, kind: 'SKIP' })
      .expect(400);
    expect(await prisma.interestSignal.count()).toBe(1);
  });
  it('rejects missing events and invalid preference fields without partially saving', async () => {
    await save({
      ...payload,
      likedEventIds: ['00000000-0000-4000-8000-000000000099'],
    }).expect(400);
    expect(await prisma.userPreference.count()).toBe(0);
    await save({ ...payload, interests: ['Unknown'] }).expect(400);
    await save({ ...payload, helpModes: ['ticket'] }).expect(400);
    await save({ ...payload, learningEnabled: 'false' }).expect(400);
    await save({ ...payload, userId: creator.id }).expect(400);
  });
  it('resets learning without forgetting picks or relearning historical attendance', async () => {
    await save({ ...payload, likedEventIds: [nature.id] }).expect(200);
    await prisma.userPreference.update({
      where: { userId: user.id },
      data: { learningSince: new Date(Date.now() - 60000) },
    });
    const transaction = await prisma.transactionReference.create({
      data: {
        userId: user.id,
        eventId: education.id,
        amount: 0,
        metadata: {},
        status: 'SUCCESS',
        paymentType: 'REGISTRATION',
      },
    });
    await prisma.registration.create({
      data: {
        userId: user.id,
        eventId: education.id,
        qrCode: 'test-registration',
        transactionId: transaction.id,
        createdAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (await preferences.getPreferences(user.id)).weights.some(
        (weight) => weight.id === 'Education',
      ),
    ).toBe(true);
    const reset = await request(app.getHttpServer())
      .post('/api/v1/preferences/reset-learning')
      .expect(201);
    expect(reset.body).toMatchObject({
      data: {
        interests: ['Nature'],
        weights: [
          expect.objectContaining({
            id: 'Nature',
            source: 'chosen',
            weight: 5,
          }),
        ],
      },
    });
    expect(await prisma.interestSignal.count()).toBe(0);
    expect(
      (await preferences.getPreferences(user.id)).weights.map(
        (weight) => weight.id,
      ),
    ).toEqual(['Nature']);
  });
  it('deletes choices and signals, stops learning and does not restart onboarding', async () => {
    await save({ ...payload, likedEventIds: [nature.id] }).expect(200);
    const deleted = await request(app.getHttpServer())
      .delete('/api/v1/preferences')
      .expect(200);
    expect(deleted.body).toMatchObject({
      data: {
        interests: [],
        helpModes: [],
        city: null,
        weights: [],
        learningEnabled: false,
      },
    });
    expect(await prisma.interestSignal.count()).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .hasPreferences,
    ).toBe(true);
    const viewed = await request(app.getHttpServer())
      .post('/api/v1/preferences/signals')
      .send({ eventId: nature.id, kind: 'VIEW' })
      .expect(201);
    expect(viewed.body).toMatchObject({ data: { recorded: false } });
    expect((await preferences.getPreferences(user.id)).weights).toEqual([]);
  });
  it('keeps deliberate event likes when passive activity learning is off', async () => {
    await save({
      ...payload,
      learningEnabled: false,
      likedEventIds: [education.id],
    }).expect(200);
    expect(
      (await preferences.getPreferences(user.id)).weights.some(
        (weight) => weight.id === 'Education',
      ),
    ).toBe(true);
    const viewed = await request(app.getHttpServer())
      .post('/api/v1/preferences/signals')
      .send({ eventId: nature.id, kind: 'VIEW' })
      .expect(201);
    expect(viewed.body).toMatchObject({ data: { recorded: false } });
    expect(await prisma.interestSignal.count({ where: { kind: 'VIEW' } })).toBe(
      0,
    );
  });

  it('does not expose or modify another user’s profile', async () => {
    await save().expect(200);
    expect(
      await prisma.userPreference.findUnique({ where: { userId: creator.id } }),
    ).toBeNull();
    authenticated = false;
    await request(app.getHttpServer()).get('/api/v1/preferences').expect(403);
    await request(app.getHttpServer())
      .delete('/api/v1/preferences')
      .expect(403);
    expect(await prisma.userPreference.count()).toBe(1);
  });
});

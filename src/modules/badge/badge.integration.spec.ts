import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { BadgeCode, Event, Prisma, User } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { getJwtSecret } from 'src/config/runtime-env';
import { PrismaService } from 'src/prisma/prisma.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { MediaService } from '../media/media.service';
import { UserController } from '../user/user.controller';
import { UserService } from '../user/user.service';
import { VolunteerService } from '../volunteer/volunteer.service';
import { TicketService } from '../ticket/ticket.service';
import { NotificationService } from '../notification/notification.service';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';
import { BadgeController } from './badge.controller';
import { BadgeService } from './badge.service';

const databaseUrl = process.env.BADGE_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
type Collection = Awaited<ReturnType<BadgeService['getMine']>>;

integration(
  'badge API, progress, awards and privacy (isolated PostgreSQL)',
  () => {
    let prisma: PrismaService;
    let service: BadgeService;
    let volunteers: VolunteerService;
    let tickets: TicketService;
    let app: INestApplication<App>;
    let owner: User;
    let user: User;
    let other: User;
    let event: Event;
    const jwt = new JwtService();
    const token = (id: string) =>
      jwt.sign({ sub: id }, { secret: getJwtSecret() });
    const badge = (collection: Collection, code: BadgeCode) =>
      collection.badges.find((item) => item.code === code)!;
    const auth = () => ({ Authorization: `Bearer ${token(user.id)}` });
    const makeEvent = (
      creatorId: string = owner.id,
      changes: Partial<Prisma.EventUncheckedCreateInput> = {},
    ) =>
      prisma.event.create({
        data: {
          title: 'Gather for good',
          creatorId,
          startDate: new Date('2026-01-01T08:00:00Z'),
          endDate: new Date('2026-01-01T20:00:00Z'),
          registrationType: 'registration',
          tags: [],
          links: [],
          ...changes,
        },
      });
    const register = (
      eventId: string = event.id,
      userId: string = user.id,
      used = true,
      scannedAt = new Date('2026-01-01T09:00:00Z'),
    ) =>
      prisma.registration.create({
        data: {
          eventId,
          userId,
          transactionId: randomUUID(),
          qrCode: randomUUID(),
          isUsed: used,
          status: used ? 'used' : 'active',
          scannedAt: used ? scannedAt : null,
        },
      });
    const donate = async (
      at: string,
      eventId = event.id,
      changes: Partial<Prisma.TransactionReferenceUncheckedCreateInput> = {},
      anonymous = false,
    ) => {
      const transaction = await prisma.transactionReference.create({
        data: {
          userId: user.id,
          creatorId: owner.id,
          eventId,
          amount: 50000,
          metadata: {},
          status: 'SUCCESS',
          paymentType: 'DONATION',
          fulfilledAt: new Date(at),
          ...changes,
        },
      });
      await prisma.donation.create({
        data: {
          userId: user.id,
          eventId,
          transactionId: transaction.id,
          amount: 50000,
          status: 'completed',
          isAnonymous: anonymous,
        },
      });
      return transaction;
    };

    beforeAll(async () => {
      if (
        !databaseUrl ||
        !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
        !new URL(databaseUrl).pathname.includes('badge_test')
      )
        throw new Error('Use an isolated local badge_test database.');
      prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
      const module = await Test.createTestingModule({
        controllers: [BadgeController, UserController],
        providers: [
          BadgeService,
          UserService,
          VolunteerService,
          TicketService,
          { provide: NotificationService, useValue: {} },
          { provide: FeedIntegrationService, useValue: {} },
          { provide: MailService, useValue: {} },
          JwtStrategy,
          { provide: PrismaService, useValue: prisma },
          { provide: MediaService, useValue: {} },
        ],
      }).compile();
      service = module.get(BadgeService);
      volunteers = module.get(VolunteerService);
      tickets = module.get(TicketService);
      app = module.createNestApplication();
      app.setGlobalPrefix('api/v1');
      app.useGlobalInterceptors(new ResponseInterceptor());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: true },
        }),
      );
      await app.init();
      await app.listen(0, '127.0.0.1');
    });
    afterAll(async () => {
      if (app) await app.close();
    });
    beforeEach(async () => {
      [owner, user, other] = await Promise.all(
        Array.from({ length: 3 }, () =>
          prisma.user.create({ data: { email: `${randomUUID()}@badge.test` } }),
        ),
      );
      event = await makeEvent();
    });
    afterEach(async () => {
      await prisma.ticket.deleteMany();
      await prisma.registration.deleteMany();
      await prisma.donation.deleteMany();
      await prisma.transactionReference.deleteMany();
      await prisma.eventTicket.deleteMany();
      await prisma.event.deleteMany();
      await prisma.user.deleteMany();
    });

    it('requires authentication and gives a new user nine locked badges with real requirements', async () => {
      await request(app.getHttpServer()).get('/api/v1/badges/me').expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1/badges/users/${user.id}`)
        .expect(401);
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/FIRST_GIFT/visibility')
        .send({ isPublic: true })
        .expect(401);
      const result = await request(app.getHttpServer())
        .get('/api/v1/badges/me')
        .set(auth())
        .expect(200);
      const collection = (result.body as { data: Collection }).data;
      expect(collection).toMatchObject({ earnedCount: 0, totalCount: 9 });
      expect(
        collection.badges.every(
          (item) =>
            item.status === 'locked' &&
            item.progress.current === 0 &&
            item.requirement.length > 0 &&
            item.gogo.message.length > 0,
        ),
      ).toBe(true);
    });

    it('counts distinct check-ins across ticket, registration and volunteer records, including early check-ins but not purchases', async () => {
      await register();
      await register();
      const tier = await prisma.eventTicket.create({
        data: {
          eventId: event.id,
          type: 'Entry',
          description: 'Entry',
          price: 0,
          quantity: 10,
        },
      });
      await prisma.ticket.create({
        data: {
          userId: user.id,
          eventTicketId: tier.id,
          transactionId: randomUUID(),
          qrCode: randomUUID(),
          status: 'used',
          isUsed: true,
          scannedAt: new Date('2026-01-01T10:00:00Z'),
        },
      });
      const unvisited = await makeEvent();
      await register(unvisited.id, user.id, false);
      await register(
        unvisited.id,
        user.id,
        true,
        new Date('2025-12-31T10:00:00Z'),
      );
      let collection = await service.getMine(user.id);
      expect(badge(collection, 'FIRST_GATHER').earnedAt).toEqual(
        new Date('2025-12-31T10:00:00Z'),
      );
      expect(badge(collection, 'FAMILIAR_FACE')).toMatchObject({
        status: 'in_progress',
        progress: { current: 2, remaining: 3, percent: 40 },
      });
      for (let index = 0; index < 4; index++)
        await register((await makeEvent()).id);
      collection = await service.getMine(user.id);
      expect(badge(collection, 'FAMILIAR_FACE')).toMatchObject({
        status: 'earned',
        progress: { current: 5, percent: 100 },
      });
    });

    it('records enough attendance data through the existing ticket verification flow to award a badge', async () => {
      const upcoming = await makeEvent(owner.id, {
        startDate: new Date('2099-01-01'),
        endDate: new Date('2099-01-02'),
      });
      const tier = await prisma.eventTicket.create({
        data: {
          eventId: upcoming.id,
          type: 'Entry',
          description: 'Entry',
          price: 0,
          quantity: 2,
        },
      });
      const ticket = await prisma.ticket.create({
        data: {
          userId: user.id,
          eventTicketId: tier.id,
          transactionId: randomUUID(),
          qrCode: randomUUID(),
        },
      });
      await tickets.verifyTicket(ticket.qrCode, false);
      expect(badge(await service.getMine(user.id), 'FIRST_GATHER').status).toBe(
        'locked',
      );
      await tickets.verifyTicket(ticket.qrCode);
      const stored = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
      });
      expect(stored.status).toBe('used');
      expect(stored.scannedAt).not.toBeNull();
      const response = await request(app.getHttpServer())
        .get('/api/v1/badges/me')
        .set(auth())
        .expect(200);
      expect(
        badge((response.body as { data: Collection }).data, 'FIRST_GATHER')
          .status,
      ).toBe('earned');
    });

    it('counts volunteer check-in as attendance and waits for the organiser to confirm actual hours', async () => {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          registrationType: 'volunteer',
          impactDescription: 'Help the community',
          location: 'Lagos',
        },
      });
      const role = await prisma.volunteerRole.create({
        data: {
          eventId: event.id,
          title: 'Helpers',
          description: 'Help out',
          capacity: 2,
        },
      });
      const application = await prisma.eventVolunteer.create({
        data: {
          eventId: event.id,
          roleId: role.id,
          userId: user.id,
          status: 'CHECKED_IN',
          checkedInAt: new Date('2026-01-01T08:00:00Z'),
        },
      });
      let collection = await service.getMine(user.id);
      expect(badge(collection, 'FIRST_GATHER').status).toBe('earned');
      expect(badge(collection, 'HELPING_HAND').status).toBe('locked');
      await volunteers.complete(event.id, application.id, owner.id, {
        confirmedMinutes: 599,
      });
      collection = await service.getMine(user.id);
      expect(badge(collection, 'HELPING_HAND').status).toBe('earned');
      expect(badge(collection, 'TIME_GIVER')).toMatchObject({
        status: 'in_progress',
        progress: {
          current: 599,
          remaining: 1,
          percent: 99,
          label: '9h 59m / 10h',
        },
      });
      const secondEvent = await makeEvent(owner.id, {
        registrationType: 'volunteer',
        impactDescription: 'Help again',
        location: 'Lagos',
      });
      const secondRole = await prisma.volunteerRole.create({
        data: {
          eventId: secondEvent.id,
          title: 'Helpers',
          description: 'Help again',
          capacity: 2,
        },
      });
      const secondApplication = await prisma.eventVolunteer.create({
        data: {
          eventId: secondEvent.id,
          roleId: secondRole.id,
          userId: user.id,
          status: 'CHECKED_IN',
          checkedInAt: new Date('2026-01-01T08:00:00Z'),
        },
      });
      await volunteers.complete(
        secondEvent.id,
        secondApplication.id,
        owner.id,
        { confirmedMinutes: 1 },
      );
      expect(badge(await service.getMine(user.id), 'TIME_GIVER').status).toBe(
        'earned',
      );
    });

    it('requires another checked-in person and an ended event for hosting, and a published post-event report for storytelling', async () => {
      const hosted = await makeEvent(user.id);
      await register(hosted.id);
      expect(badge(await service.getMine(user.id), 'GATHER_MAKER').status).toBe(
        'locked',
      );
      await register(hosted.id, other.id);
      expect(badge(await service.getMine(user.id), 'GATHER_MAKER').status).toBe(
        'earned',
      );
      await prisma.eventImpactReport.create({
        data: {
          eventId: hosted.id,
          creatorId: user.id,
          summary: 'Our community gathered',
          evidenceLinks: [],
          status: 'DRAFT',
        },
      });
      expect(
        badge(await service.getMine(user.id), 'IMPACT_STORYTELLER').status,
      ).toBe('locked');
      await prisma.eventImpactReport.update({
        where: { eventId: hosted.id },
        data: { status: 'PUBLISHED', publishedAt: new Date('2026-01-02') },
      });
      expect(
        badge(await service.getMine(user.id), 'IMPACT_STORYTELLER').status,
      ).toBe('earned');
      await prisma.eventImpactReport.update({
        where: { eventId: hosted.id },
        data: { publishedAt: new Date('2026-01-03') },
      });
      expect(
        badge(await service.getMine(user.id), 'IMPACT_STORYTELLER').earnedAt,
      ).toEqual(new Date('2026-01-02'));
      await prisma.event.update({
        where: { id: hosted.id },
        data: { endDate: new Date('2099-01-01') },
      });
      const future = await service.getMine(user.id);
      expect(badge(future, 'GATHER_MAKER').status).toBe('locked');
      expect(badge(future, 'IMPACT_STORYTELLER').status).toBe('locked');
    });

    it('counts only fulfilled successful donation transactions and removes refunded contributions', async () => {
      await donate('2026-01-01', event.id, { status: 'PENDING' });
      await donate('2026-01-01', event.id, { status: 'FAILED' });
      await donate('2026-01-01', event.id, { fulfilledAt: null });
      await donate('2026-01-01', event.id, { paymentType: 'TICKET' });
      expect(badge(await service.getMine(user.id), 'FIRST_GIFT').status).toBe(
        'locked',
      );
      const gift = await donate('2026-01-02', event.id, {}, true);
      expect(badge(await service.getMine(user.id), 'FIRST_GIFT')).toMatchObject(
        { status: 'earned', isPublic: false },
      );
      await service.setVisibility(user.id, 'FIRST_GIFT', true);
      await prisma.checkoutRefund.create({
        data: {
          transactionId: gift.id,
          amountKobo: 50000,
          reason: 'Refund requested',
        },
      });
      expect(badge(await service.getMine(user.id), 'FIRST_GIFT').status).toBe(
        'locked',
      );
      expect(await service.getPublic(user.id)).toEqual([]);
      expect(
        await prisma.userBadge.findUniqueOrThrow({
          where: { userId_code: { userId: user.id, code: 'FIRST_GIFT' } },
        }),
      ).toMatchObject({ earnedAt: null, isPublic: true });
    });

    it('deduplicates repeated gifts to one event and counts distinct Lagos calendar months', async () => {
      await donate('2025-12-31T23:30:00Z');
      await donate('2026-01-15T12:00:00Z');
      let collection = await service.getMine(user.id);
      expect(badge(collection, 'COMMUNITY_BACKER').progress.current).toBe(1);
      expect(badge(collection, 'STEADY_GIVER').progress.current).toBe(1);
      await donate('2026-03-01T12:00:00Z', (await makeEvent()).id);
      await donate('2026-06-01T12:00:00Z', (await makeEvent()).id);
      collection = await service.getMine(user.id);
      expect(badge(collection, 'COMMUNITY_BACKER').status).toBe('earned');
      expect(badge(collection, 'STEADY_GIVER')).toMatchObject({
        status: 'earned',
        earnedAt: new Date('2026-06-01T12:00:00Z'),
      });
    });

    it('keeps anonymous giving private by default and exposes only opted-in badge metadata on public profiles', async () => {
      await donate('2026-01-01', event.id, {}, true);
      await register();
      const profile = await request(app.getHttpServer())
        .get(`/api/v1/user/public/${user.id}`)
        .set('Authorization', `Bearer ${token(other.id)}`)
        .expect(200);
      expect(
        (
          profile.body as { data: { badges: { code: BadgeCode }[] } }
        ).data.badges.map((item) => item.code),
      ).toEqual(['FIRST_GATHER']);
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/FIRST_GIFT/visibility')
        .set(auth())
        .send({ isPublic: true })
        .expect(200);
      const result = await request(app.getHttpServer())
        .get(`/api/v1/badges/users/${user.id}`)
        .set('Authorization', `Bearer ${token(other.id)}`)
        .expect(200);
      const badges = (result.body as { data: { code: BadgeCode }[] }).data;
      expect(badges.map((item) => item.code)).toContain('FIRST_GIFT');
      expect(
        Object.keys(badges.find((item) => item.code === 'FIRST_GIFT')!).sort(),
      ).toEqual([
        'category',
        'code',
        'description',
        'earnedAt',
        'icon',
        'name',
      ]);
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/FIRST_GIFT/visibility')
        .set(auth())
        .send({ isPublic: false })
        .expect(200);
      expect(
        (await service.getPublic(user.id)).map((item) => item.code),
      ).toEqual(['FIRST_GATHER']);
    });

    it('rejects invalid visibility, unearned badges, invalid codes and cross-account changes', async () => {
      await donate('2026-01-01');
      for (const input of [
        {},
        { isPublic: null },
        { isPublic: 'false' },
        { isPublic: 1 },
        { isPublic: true, userId: other.id },
      ]) {
        await request(app.getHttpServer())
          .patch('/api/v1/badges/me/FIRST_GIFT/visibility')
          .set(auth())
          .send(input)
          .expect(400);
      }
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/MADE_UP/visibility')
        .set(auth())
        .send({ isPublic: true })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/TIME_GIVER/visibility')
        .set(auth())
        .send({ isPublic: true })
        .expect(400);
      await request(app.getHttpServer())
        .patch('/api/v1/badges/me/FIRST_GIFT/visibility')
        .set('Authorization', `Bearer ${token(other.id)}`)
        .send({ isPublic: true })
        .expect(400);
      expect(badge(await service.getMine(user.id), 'FIRST_GIFT').isPublic).toBe(
        false,
      );
      await request(app.getHttpServer())
        .get(`/api/v1/badges/users/${randomUUID()}`)
        .set(auth())
        .expect(404);
    });

    it('reconciles concurrent requests without duplicate awards and retains privacy choices on refresh', async () => {
      await donate('2026-01-01');
      await Promise.all([
        service.getMine(user.id),
        service.getMine(user.id),
        service.getMine(user.id),
      ]);
      expect(
        await prisma.userBadge.count({
          where: { userId: user.id, code: 'FIRST_GIFT' },
        }),
      ).toBe(1);
      await service.setVisibility(user.id, 'FIRST_GIFT', true);
      expect(badge(await service.getMine(user.id), 'FIRST_GIFT')).toMatchObject(
        { isPublic: true, earnedAt: new Date('2026-01-01') },
      );
    });
  },
);

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  Event,
  RegistrationType,
  VolunteerRole,
  VolunteerStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { getJwtSecret } from 'src/config/runtime-env';
import { PrismaService } from 'src/prisma/prisma.service';
import { CarpoolQueueService } from 'src/queue/carpool/queue.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { EventController } from '../event/event.controller';
import { EventService } from '../event/event.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { MediaService } from '../media/media.service';
import { VolunteerController } from './volunteer.controller';
import { VolunteerService } from './volunteer.service';
import { EventsService } from '../dashboard/services/events.service';
import { EventsDashboardService } from '../dashboard/services/events-dashboard.service';
import { DashboardService } from '../dashboard/services/dashboard.service';
import { EventFilter } from '../dashboard/dto/get-events.dto';
import { DonationService } from '../donation/donation.service';
import { NotificationService } from '../notification/notification.service';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { RecurringEventService } from 'src/cron-jobs/recurring-event.service';
import { TransactionReferenceService } from '../transaction-reference/transaction-reference.service';
import { PaystackService } from '../paystack/paystack.service';
import { AlatCollectionService } from '../transaction-reference/alat-collection.service';
import { TicketService } from '../ticket/ticket.service';
import { RegistrationService } from '../registration/registration.service';
import { CheckoutService } from '../checkout/checkout.service';

const databaseUrl = process.env.VOLUNTEER_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('physical event volunteering (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let service: VolunteerService;
  let events: EventService;
  let app: INestApplication<App>;
  let dashboardEvents: EventsService;
  let eventDashboard: EventsDashboardService;
  let dashboard: DashboardService;
  let donations: DonationService;
  let payments: TransactionReferenceService;
  let event: Event;
  let role: VolunteerRole;
  let users: string[];
  const jwt = new JwtService();
  const token = (id: string) =>
    jwt.sign({ sub: id }, { secret: getJwtSecret() });
  const roleInput = {
    title: 'Planters',
    description: 'Help plant seedlings.',
    capacity: 2,
  };

  beforeAll(async () => {
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
      !new URL(databaseUrl).pathname.includes('volunteer_test')
    ) {
      throw new Error('Use an isolated local volunteer_test database.');
    }
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    const module = await Test.createTestingModule({
      controllers: [EventController, VolunteerController],
      providers: [
        VolunteerService,
        EventService,
        EventTicketService,
        JwtStrategy,
        EventsService,
        EventsDashboardService,
        DashboardService,
        DonationService,
        TransactionReferenceService,
        { provide: PaystackService, useValue: {} },
        { provide: AlatCollectionService, useValue: {} },
        { provide: TicketService, useValue: {} },
        { provide: RegistrationService, useValue: {} },
        { provide: CheckoutService, useValue: {} },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FeedIntegrationService,
          useValue: { onDonationMade: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MailService,
          useValue: {
            sendDonationConfirmation: jest
              .fn()
              .mockResolvedValue({ skipped: false }),
          },
        },
        { provide: PrismaService, useValue: prisma },
        {
          provide: CarpoolQueueService,
          useValue: { addUpdateExpiryJob: jest.fn() },
        },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    service = module.get(VolunteerService);
    events = module.get(EventService);
    dashboardEvents = module.get(EventsService);
    eventDashboard = module.get(EventsDashboardService);
    dashboard = module.get(DashboardService);
    donations = module.get(DonationService);
    payments = module.get(TransactionReferenceService);
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
    users = await Promise.all(
      Array.from(
        { length: 8 },
        async () =>
          (
            await prisma.user.create({
              data: { email: `${randomUUID()}@volunteer.test` },
            })
          ).id,
      ),
    );
    event = await prisma.event.create({
      data: {
        title: 'Plant trees',
        impactDescription: 'Restore green spaces for the community.',
        creatorId: users[0],
        registrationType: 'volunteer',
        isPhysicalEvent: true,
        location: 'Community garden, Lagos',
        startDate: new Date(Date.now() + 3600000),
        endDate: new Date(Date.now() + 10800000),
        tags: [],
        links: [],
      },
    });
    role = await prisma.volunteerRole.create({
      data: { ...roleInput, eventId: event.id },
    });
  });

  afterEach(async () => {
    await prisma.donation.deleteMany({
      where: { event: { creatorId: users[0] } },
    });
    await prisma.event.deleteMany({ where: { creatorId: users[0] } });
    await prisma.creatorSettlementProfile.deleteMany({
      where: { userId: { in: users } },
    });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  const createPayload = () => ({
    title: 'Blood donation support',
    description: 'Help run the local blood donation drive.',
    impactDescription: 'Help our community support patients who need blood.',
    registrationType: 'volunteer',
    location: 'Lagos',
    startDate: event.startDate.toISOString(),
    endDate: event.endDate.toISOString(),
    volunteerRoles: [roleInput],
  });

  it('keeps volunteer participation and optional donations visible in organiser dashboards', async () => {
    await service.updateRole(event.id, role.id, users[0], {
      requiresApproval: false,
    });
    await service.apply(event.id, role.id, users[1], {});
    await events.update(users[0], event.id, {
      donationsEnabled: true,
      donationTarget: 500000,
    });
    await prisma.donation.create({
      data: {
        userId: users[2],
        eventId: event.id,
        amount: 100000,
        status: 'completed',
        transactionId: randomUUID(),
      },
    });
    expect(
      (await dashboardEvents.getEvents(users[0], { filter: EventFilter.ALL }))
        .data[0],
    ).toMatchObject({
      participants: 1,
      raised: 1000,
      goal: 5000,
      volunteering: { confirmedPlaces: 1, recruitmentProgress: 50 },
    });
    expect(
      (await eventDashboard.getEventDashboardData(users[0], event.id)).event,
    ).toMatchObject({
      type: 'volunteer',
      participants: 1,
      raised: 1000,
      volunteering: { confirmedPlaces: 1 },
    });
    expect(
      (await dashboard.getDashboardData(users[0])).events[0],
    ).toMatchObject({
      participants: 1,
      raised: 1000,
      volunteering: { confirmedPlaces: 1 },
    });
  });

  it('records an already verified donation even when the organiser has disabled new donations', async () => {
    const donation = await donations.createDonation(
      { eventId: event.id, amount: 50000, transactionId: randomUUID() },
      users[1],
      'Volunteer',
    );
    expect(donation).toMatchObject({
      event: { id: event.id },
      amount: 50000,
      status: 'completed',
    });
  });

  it('rejects new donation payments when optional fundraising is disabled', async () => {
    await expect(
      payments.initiateDonation(users[1], 'volunteer@example.com', {
        eventId: event.id,
        amount: 500,
      }),
    ).rejects.toThrow('not accepting donations');
    expect(
      await prisma.transactionReference.count({ where: { eventId: event.id } }),
    ).toBe(0);
  });

  it('requires authentication for recruitment and application routes', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/events/${event.id}/volunteer-roles`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/events/${event.id}/volunteer-roles/${role.id}/apply`)
      .send({})
      .expect(401);
  });

  it('creates a physical volunteer-only event without attendee registration, tickets, or money', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token(users[0])}`)
      .send(createPayload())
      .expect(201);
    const response = result.body as { data: Event };
    const created = response.data;
    expect(created).toMatchObject({
      registrationType: 'volunteer',
      donationsEnabled: false,
      registrationFee: null,
      registrationAttendees: null,
      donationTarget: null,
    });
    expect(
      await prisma.volunteerRole.count({ where: { eventId: created.id } }),
    ).toBe(1);
    expect(
      await prisma.creatorSettlementProfile.count({
        where: { userId: users[0] },
      }),
    ).toBe(0);
    expect(
      await prisma.eventTicket.count({ where: { eventId: created.id } }),
    ).toBe(0);
    expect(
      await prisma.registration.count({ where: { eventId: created.id } }),
    ).toBe(0);
  });

  it('parses role configuration and false boolean values from multipart event creation', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token(users[0])}`)
      .field('title', 'Plant trees')
      .field('description', 'Help plant trees together.')
      .field('impactDescription', 'Restore green spaces for the community.')
      .field('registrationType', 'volunteer')
      .field('location', 'Lagos')
      .field('isPhysicalEvent', 'true')
      .field('donationsEnabled', 'false')
      .field('startDate', event.startDate.toISOString())
      .field('endDate', event.endDate.toISOString())
      .field(
        'volunteerRoles',
        JSON.stringify([{ ...roleInput, requiresApproval: false }]),
      )
      .expect(201);
    const response = result.body as { data: Event };
    const created = response.data;
    expect(created.donationsEnabled).toBe(false);
    expect(
      await prisma.volunteerRole.findFirstOrThrow({
        where: { eventId: created.id },
      }),
    ).toMatchObject({ requiresApproval: false });
  });

  it('blocks ticket creation and attendee registration settings on volunteer-only events', async () => {
    await expect(
      new EventTicketService(prisma).create(event.id, users[0], {
        type: 'General',
        description: 'Entry',
        price: 0,
        quantity: 10,
        perks: [],
      }),
    ).rejects.toThrow('only available for ticketed events');
    await request(app.getHttpServer())
      .patch(`/api/v1/events/${event.id}`)
      .set('Authorization', `Bearer ${token(users[0])}`)
      .send({ registrationFee: 0 })
      .expect(400);
  });

  it.each([
    { volunteerRoles: undefined },
    { volunteerRoles: [] },
    { volunteerRoles: '[invalid' },
    { volunteerRoles: [{ ...roleInput, capacity: 0 }] },
    { volunteerRoles: [{ ...roleInput, requiresApproval: 'false' }] },
    { volunteerRoles: [{ ...roleInput, requiresApproval: null }] },
    { impactDescription: undefined },
    { impactDescription: '' },
    { impactDescription: '   ', impactTitle: 'Community impact' },
    { isPhysicalEvent: false },
    { registrationFee: 0 },
    { donationTarget: 500000 },
  ])(
    'rejects incomplete or contradictory volunteer event configuration: %j',
    async (changes) => {
      await request(app.getHttpServer())
        .post('/api/v1/events')
        .set('Authorization', `Bearer ${token(users[0])}`)
        .send({ ...createPayload(), ...changes })
        .expect(400);
    },
  );

  it.each([
    RegistrationType.ticket,
    RegistrationType.registration,
    RegistrationType.donation,
  ])(
    'supports volunteer roles on a physical %s event with impact',
    async (registrationType) => {
      await prisma.event.update({
        where: { id: event.id },
        data: { registrationType, impactTitle: 'Support our community' },
      });
      expect(
        await service.createRole(event.id, users[0], roleInput),
      ).toMatchObject({ eventId: event.id });
    },
  );

  it('rejects recruitment on ordinary events and online events, including organiser attempts', async () => {
    await prisma.event.update({
      where: { id: event.id },
      data: { registrationType: 'registration', impactDescription: null },
    });
    await expect(
      service.createRole(event.id, users[0], roleInput),
    ).rejects.toThrow('Add an impact story');
    await prisma.event.update({
      where: { id: event.id },
      data: { impactTitle: 'Impact', isPhysicalEvent: false },
    });
    await expect(
      service.createRole(event.id, users[0], roleInput),
    ).rejects.toThrow('physical events');
    await expect(
      service.apply(event.id, role.id, users[1], {}),
    ).rejects.toThrow('physical events');
  });

  it.each([RegistrationType.donation, RegistrationType.volunteer])(
    'does not allow %s events to add roles or accept applications without a story',
    async (registrationType) => {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          registrationType,
          impactTitle: 'Community impact',
          impactDescription: '   ',
        },
      });
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/volunteer-roles`)
        .set('Authorization', `Bearer ${token(users[0])}`)
        .send(roleInput)
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/volunteer-roles/${role.id}/apply`)
        .set('Authorization', `Bearer ${token(users[1])}`)
        .send({})
        .expect(400);
      expect(
        await prisma.eventVolunteer.count({ where: { eventId: event.id } }),
      ).toBe(0);
    },
  );

  it('keeps optional donations separate from volunteer participation and payment requirements', async () => {
    await events.update(users[0], event.id, { donationsEnabled: true });
    expect(
      await prisma.creatorSettlementProfile.findUnique({
        where: { userId: users[0] },
      }),
    ).not.toBeNull();
    const details = await events.findOne(event.id, users[1]);
    expect(details.paymentOptions).toMatchObject({
      requiresPayment: false,
      acceptsDonations: true,
      supportsPaystack: true,
    });
    expect((await service.apply(event.id, role.id, users[1], {})).status).toBe(
      'APPLIED',
    );
    expect(
      await prisma.transactionReference.count({ where: { eventId: event.id } }),
    ).toBe(0);
  });

  it('does not let event edits invalidate existing volunteering', async () => {
    await expect(
      events.update(users[0], event.id, { isPhysicalEvent: false }),
    ).rejects.toThrow('physical events');
    await prisma.event.update({
      where: { id: event.id },
      data: { registrationType: 'registration', impactTitle: 'Impact' },
    });
    await expect(
      events.update(users[0], event.id, { impactDescription: '' }),
    ).rejects.toThrow('Add an impact story');
  });

  it('uses approval, then confirms accepted places without issuing registrations or tickets', async () => {
    const application = await service.apply(event.id, role.id, users[1], {
      note: 'Happy to help.',
    });
    expect(application.status).toBe(VolunteerStatus.APPLIED);
    expect((await service.summary(event.id)).counts.ACCEPTED).toBe(0);
    await request(app.getHttpServer())
      .patch(`/api/v1/events/${event.id}/volunteers/${application.id}/review`)
      .set('Authorization', `Bearer ${token(users[0])}`)
      .send({ status: 'ACCEPTED' })
      .expect(200);
    expect((await service.summary(event.id)).counts.ACCEPTED).toBe(1);
  });

  it('accepts immediately when the organiser disables approval and serializes capacity allocation', async () => {
    await service.updateRole(event.id, role.id, users[0], {
      requiresApproval: false,
      capacity: 1,
    });
    const results = await Promise.allSettled(
      users.slice(1).map((id) => service.apply(event.id, role.id, id, {})),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.eventVolunteer.count({
        where: { eventId: event.id, status: 'ACCEPTED' },
      }),
    ).toBe(1);
  });

  it('serializes approval of the last available place', async () => {
    await service.updateRole(event.id, role.id, users[0], { capacity: 1 });
    const applications = await Promise.all(
      users.slice(1, 4).map((id) => service.apply(event.id, role.id, id, {})),
    );
    const results = await Promise.allSettled(
      applications.map((entry) =>
        service.review(event.id, entry.id, users[0], { status: 'ACCEPTED' }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect((await service.summary(event.id)).counts.ACCEPTED).toBe(1);
  });

  it('keeps retries idempotent and allows one volunteer place per person per event', async () => {
    const applications = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.apply(event.id, role.id, users[1], {}),
      ),
    );
    expect(new Set(applications.map((entry) => entry.id)).size).toBe(1);
    const secondRole = await service.createRole(event.id, users[0], roleInput);
    await expect(
      service.apply(event.id, secondRole.id, users[1], {}),
    ).rejects.toThrow('already have');
    await service.withdraw(event.id, applications[0].id, users[1]);
    expect(
      (await service.apply(event.id, secondRole.id, users[1], {})).roleId,
    ).toBe(secondRole.id);
  });

  it('enforces ownership, application privacy, role ownership, and capacity edits', async () => {
    await service.updateRole(event.id, role.id, users[0], {
      requiresApproval: false,
    });
    const first = await service.apply(event.id, role.id, users[1], {});
    await service.apply(event.id, role.id, users[2], {});
    await expect(
      service.updateRole(event.id, role.id, users[0], { capacity: 1 }),
    ).rejects.toThrow('confirmed volunteer places');
    await expect(
      service.review(event.id, first.id, users[2], { status: 'DECLINED' }),
    ).rejects.toThrow('organiser');
    await expect(
      service.withdraw(event.id, first.id, users[2]),
    ).rejects.toThrow('your own');
    await expect(service.listApplications(event.id, users[1])).rejects.toThrow(
      'organiser',
    );
    expect(
      (await service.listRoles(event.id, users[1]))[0].applications,
    ).toHaveLength(1);
    await expect(
      service.apply(randomUUID(), role.id, users[1], {}),
    ).rejects.toThrow('Event not found');
    await expect(
      service.apply(event.id, randomUUID(), users[3], {}),
    ).rejects.toThrow('Volunteer role not found');
  });

  it('closes recruitment, records attendance, and counts only confirmed work', async () => {
    await service.updateRole(event.id, role.id, users[0], {
      requiresApproval: false,
    });
    const application = await service.apply(event.id, role.id, users[1], {});
    await expect(
      service.checkIn(event.id, application.id, users[0]),
    ).rejects.toThrow('during the event');
    await prisma.event.update({
      where: { id: event.id },
      data: { startDate: new Date(Date.now() - 60000) },
    });
    await expect(
      service.apply(event.id, role.id, users[2], {}),
    ).rejects.toThrow('closes');
    await service.checkIn(event.id, application.id, users[0]);
    expect((await service.summary(event.id)).confirmedMinutes).toBe(0);
    await expect(
      service.complete(event.id, application.id, users[0], {
        confirmedMinutes: 60,
      }),
    ).rejects.toThrow('after the event');
    const checkedInAt = new Date(Date.now() - 7200000);
    await prisma.eventVolunteer.update({
      where: { id: application.id },
      data: { checkedInAt },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { startDate: checkedInAt, endDate: new Date(Date.now() - 60000) },
    });
    await expect(
      service.complete(event.id, application.id, users[0], {
        confirmedMinutes: 180,
      }),
    ).rejects.toThrow('cannot exceed');
    await service.complete(event.id, application.id, users[0], {
      confirmedMinutes: 90,
    });
    await service.complete(event.id, application.id, users[0], {
      confirmedMinutes: 90,
    });
    expect(await service.summary(event.id)).toMatchObject({
      counts: { COMPLETED: 1 },
      confirmedMinutes: 90,
      confirmedHours: 1.5,
    });
    expect((await service.history(users[1]))[0]).toMatchObject({
      confirmedById: users[0],
      confirmedMinutes: 90,
    });
  });

  it('rejects arbitrary acceptance states and fractional confirmed minutes at the API boundary', async () => {
    const application = await service.apply(event.id, role.id, users[1], {});
    await request(app.getHttpServer())
      .patch(`/api/v1/events/${event.id}/volunteers/${application.id}/review`)
      .set('Authorization', `Bearer ${token(users[0])}`)
      .send({ status: 'COMPLETED' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/events/${event.id}/volunteers/${application.id}/complete`)
      .set('Authorization', `Bearer ${token(users[0])}`)
      .send({ confirmedMinutes: 1.5 })
      .expect(400);
  });

  it('copies role configuration and optional fundraising to recurring events without copying volunteers', async () => {
    await service.apply(event.id, role.id, users[1], {});
    await prisma.event.update({
      where: { id: event.id },
      data: {
        reoccurring: 'DAILY',
        donationsEnabled: true,
        startDate: new Date(Date.now() - 7200000),
        endDate: new Date(Date.now() - 3600000),
      },
    });
    await new RecurringEventService(prisma).handleRecurringEvents();
    const nextEvent = await prisma.event.findFirstOrThrow({
      where: { creatorId: users[0], id: { not: event.id } },
      include: { volunteerRoles: true, volunteers: true },
    });
    expect(nextEvent).toMatchObject({
      registrationType: 'volunteer',
      donationsEnabled: true,
      volunteers: [],
    });
    expect(nextEvent.volunteerRoles).toHaveLength(1);
    expect(nextEvent.volunteerRoles[0]).toMatchObject(roleInput);
    expect(nextEvent.volunteerRoles[0].id).not.toBe(role.id);
  });
});

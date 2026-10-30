import * as request from 'supertest';
import type { Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { createPublicWebHarness } from '../../../test/public-web-harness';
import { TransactionReferenceService } from '../transaction-reference/transaction-reference.service';
import { FoodBankService } from '../food-bank/food-bank.service';
import { AuthService } from '../auth/auth.service';
import { WebSessionService } from './web-session.service';
import { PublicWebService } from './public-web.service';
import { PublicWebController } from './public-web.controller';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from '../../common/constants';

type WebData<K extends keyof PublicWebService> = Awaited<
  ReturnType<PublicWebService[K]>
>;
function typedResponse<T>(
  response: request.Response,
): Omit<request.Response, 'body'> & { body: { data: T } } {
  return response;
}

const integration = process.env.PUBLIC_WEB_TEST_DATABASE_URL
  ? describe
  : describe.skip;
integration('public web participation (isolated PostgreSQL)', () => {
  let harness: Awaited<ReturnType<typeof createPublicWebHarness>>;
  const api = () => {
    const server: Server = harness.app.getHttpServer();
    return request(server);
  };
  const email = () => `guest-${randomUUID()}@example.test`;
  async function verify(address = email()) {
    const challenge = typedResponse<
      Awaited<ReturnType<WebSessionService['requestCode']>>
    >(
      await api()
        .post('/api/v1/public/email/code')
        .send({ email: address })
        .expect(201),
    );
    const response = typedResponse<
      Awaited<ReturnType<WebSessionService['verifyCode']>>
    >(
      await api()
        .post('/api/v1/public/email/verify')
        .send({
          challengeId: challenge.body.data.challengeId,
          code: harness.codes.get(address),
        })
        .expect(201),
    );
    const session: Awaited<ReturnType<WebSessionService['verifyCode']>> =
      response.body.data;
    return session;
  }
  beforeAll(async () => {
    harness = await createPublicWebHarness({ rateLimits: false });
  });
  afterAll(async () => {
    await harness.app.close();
  });

  it('shows public details without organiser email, applicant data or account credentials', async () => {
    const response = typedResponse<WebData<'event'>>(
      await api()
        .get(`/api/v1/public/events/${harness.volunteerEvent.id}`)
        .expect(200),
    );
    expect(response.body.data.title).toBe(harness.volunteerEvent.title);
    expect(response.body.data.creator).not.toHaveProperty('email');
    expect(response.body.data.creator).not.toHaveProperty('password');
    expect(response.body.data.volunteerRoles[0]).not.toHaveProperty(
      'applications',
    );
    await api()
      .post('/api/v1/public/donations')
      .send({ eventId: harness.foodBank.id, amount: 500 })
      .expect(401);
  });

  it('verifies email before creating an identity, rejects replay, and cannot issue native app tokens', async () => {
    const address = email();
    const challenge = typedResponse<
      Awaited<ReturnType<WebSessionService['requestCode']>>
    >(
      await api()
        .post('/api/v1/public/email/code')
        .send({ email: ` ${address.toUpperCase()} ` })
        .expect(201),
    );
    expect(challenge.body.data).not.toHaveProperty('existingAccount');
    expect(
      await harness.prisma.user.findUnique({ where: { email: address } }),
    ).toBeNull();
    const body = {
      challengeId: challenge.body.data.challengeId,
      code: harness.codes.get(address),
    };
    const verified = typedResponse<
      Awaited<ReturnType<WebSessionService['verifyCode']>>
    >(await api().post('/api/v1/public/email/verify').send(body).expect(201));
    expect(verified.body.data.token).toMatch(/^[a-f0-9]{64}$/);
    expect(verified.body.data).not.toHaveProperty('accessToken');
    expect(verified.body.data.existingAccount).toBe(false);
    await api().post('/api/v1/public/email/verify').send(body).expect(400);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: address },
    });
    expect(user.isGuest).toBe(true);
    expect(user.password).toBeNull();
  });

  it('commits failed code attempts, enforces expiry, and rate-limits email resends in the database', async () => {
    const address = email();
    const challenge = typedResponse<
      Awaited<ReturnType<WebSessionService['requestCode']>>
    >(
      await api()
        .post('/api/v1/public/email/code')
        .send({ email: address })
        .expect(201),
    );
    const challengeId: string = challenge.body.data.challengeId;
    await api()
      .post('/api/v1/public/email/code')
      .send({ email: address })
      .expect(400);
    const correct = harness.codes.get(address);
    const wrong = correct === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      await api()
        .post('/api/v1/public/email/verify')
        .send({ challengeId, code: wrong })
        .expect(400);
    expect(
      (
        await harness.prisma.webEmailChallenge.findUniqueOrThrow({
          where: { id: challengeId },
        })
      ).attempts,
    ).toBe(5);
    await api()
      .post('/api/v1/public/email/verify')
      .send({ challengeId, code: correct })
      .expect(400);
    await harness.prisma.webEmailChallenge.update({
      where: { id: challengeId },
      data: { attempts: 0, expiresAt: new Date(0) },
    });
    await api()
      .post('/api/v1/public/email/verify')
      .send({ challengeId, code: correct })
      .expect(400);
  });

  it('finds existing accounts only after email proof, expires and revokes web sessions', async () => {
    const user = await harness.prisma.user.create({
      data: { email: email(), fullName: 'Existing member' },
    });
    const session = await verify(user.email);
    expect(session.existingAccount).toBe(true);
    const current = typedResponse<ReturnType<PublicWebController['session']>>(
      await api()
        .get('/api/v1/public/session')
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(current.body.data.fullName).toBe('Existing member');
    await api()
      .post('/api/v1/public/session/end')
      .auth(session.token, { type: 'bearer' })
      .expect(201);
    await api()
      .get('/api/v1/public/session')
      .auth(session.token, { type: 'bearer' })
      .expect(401);
  });

  it('issues free tickets once under concurrent retries and protects their QR receipt from other guests', async () => {
    const session = await verify();
    const key = randomUUID();
    const body = {
      items: [
        {
          id: harness.ticketEvent.eventTickets.find(
            (ticket) => ticket.price === 0,
          )!.id,
          quantity: 1,
          ticketName: 'Community pass',
        },
      ],
    };
    const rawResponses = await Promise.all(
      [0, 1].map(() =>
        api()
          .post('/api/v1/public/tickets')
          .auth(session.token, { type: 'bearer' })
          .set('Idempotency-Key', key)
          .send(body)
          .expect(201),
      ),
    );
    const responses = rawResponses.map((response) =>
      typedResponse<WebData<'tickets'>>(response),
    );
    const id: string = responses[0].body.data.transactionId;
    expect(responses[1].body.data.transactionId).toBe(id);
    expect(
      await harness.prisma.ticket.count({ where: { transactionId: id } }),
    ).toBe(1);
    const receipt = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(receipt.body.data.status).toBe('SUCCESS');
    expect(receipt.body.data.tickets[0].qrImage).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(receipt.body.data).not.toHaveProperty('riskReviewNote');
    const other = await verify();
    await api()
      .get(`/api/v1/public/checkouts/${id}`)
      .auth(other.token, { type: 'bearer' })
      .expect(404);
  });

  it('registers once, preserving the same user record for eventual app signup', async () => {
    const session = await verify();
    const first = typedResponse<WebData<'registration'>>(
      await api()
        .post(
          `/api/v1/public/events/${harness.registrationEvent.id}/registration`,
        )
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .expect(201),
    );
    expect(first.body.data.checkoutStatus).toBe('SUCCESS');
    await api()
      .post(
        `/api/v1/public/events/${harness.registrationEvent.id}/registration`,
      )
      .auth(session.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .expect(409);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    const auth = harness.module.get(AuthService);
    const signup = await auth.signup({
      email: session.email,
      password: 'Fixture-password-2026!',
    });
    expect(signup).toHaveProperty('requiresVerification', true);
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .password,
    ).toBeNull();
    const pending = await harness.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    await expect(
      auth.signup({
        email: session.email,
        password: 'Another-fixture-password!',
      }),
    ).rejects.toThrow('Please wait');
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .pendingPasswordHash,
    ).toBe(pending.pendingPasswordHash);

    await auth.verifyEmailCode({
      email: session.email,
      code: harness.codes.get(session.email)!,
    });
    const completed = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    expect(completed.id).toBe(user.id);
    expect(completed.isGuest).toBe(false);
    expect(
      await harness.prisma.registration.count({
        where: { userId: completed.id, eventId: harness.registrationEvent.id },
      }),
    ).toBe(1);
  });

  it('uses server pricing and payment confirmation before issuing paid passes', async () => {
    const session = await verify();
    const ticket = harness.ticketEvent.eventTickets.find(
      (item) => item.price > 0,
    )!;
    const checkout = typedResponse<WebData<'tickets'>>(
      await api()
        .post('/api/v1/public/tickets')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({
          items: [{ id: ticket.id, quantity: 1, ticketName: ticket.type }],
        })
        .expect(201),
    );
    const id: string = checkout.body.data.transactionId;
    expect(harness.initializations.at(-1)!.callback_url).toBe(
      `https://gathergo.events/checkout/${id}`,
    );
    expect(
      await harness.prisma.ticket.count({ where: { transactionId: id } }),
    ).toBe(0);
    const pending = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(pending.body.data.status).toBe('PENDING');
    expect(pending.body.data.paymentAccessCode).toBe('fixture');
    expect(pending.body.data.paymentUrl).toBe(
      `https://checkout.paystack.com/fixture-${id}`,
    );
    expect(pending.body.data.tickets).toHaveLength(0);
    expect(
      await harness.prisma.notification.count({
        where: { recipient: { email: session.email } },
      }),
    ).toBe(0);
    await harness.confirm(id);
    const receipt = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(receipt.body.data.status).toBe('SUCCESS');
    expect(receipt.body.data.tickets).toHaveLength(1);
    expect(receipt.body.data.paymentAccessCode).toBeNull();
    expect(receipt.body.data.paymentUrl).toBeNull();
  });

  it('supports Paystack for paid web registrations and hides expired checkout credentials', async () => {
    const session = await verify();
    await harness.prisma.event.update({
      where: { id: harness.registrationEvent.id },
      data: { registrationFee: 1000 },
    });
    const checkout = typedResponse<WebData<'registration'>>(
      await api()
        .post(
          `/api/v1/public/events/${harness.registrationEvent.id}/registration`,
        )
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(201),
    );
    const id = checkout.body.data.transactionId;
    const pending = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(pending.body.data.paymentAccessCode).toBe('fixture');
    expect(pending.body.data.registrations).toHaveLength(0);
    const otherSession = await verify();
    await api()
      .get(`/api/v1/public/checkouts/${id}`)
      .auth(otherSession.token, { type: 'bearer' })
      .expect(404);
    await harness.prisma.checkoutReservation.update({
      where: { transactionId: id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(expired.body.data.status).toBe('EXPIRED');
    expect(expired.body.data.paymentAccessCode).toBeNull();
    expect(expired.body.data.paymentUrl).toBeNull();
    const retry = typedResponse<WebData<'registration'>>(
      await api()
        .post(
          `/api/v1/public/events/${harness.registrationEvent.id}/registration`,
        )
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(201),
    );
    await harness.confirm(retry.body.data.transactionId);
    const confirmed = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${retry.body.data.transactionId}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(confirmed.body.data.status).toBe('SUCCESS');
    expect(confirmed.body.data.registrations).toHaveLength(1);
    expect(confirmed.body.data.paymentAccessCode).toBeNull();
  });

  it('records web food donations idempotently, without granting meal passes on payment or replay', async () => {
    const session = await verify();
    const body = {
      eventId: harness.foodBank.id,
      amount: 500,
      source: 'FOOD_BANK',
    };
    const key = randomUUID();
    const checkout = typedResponse<WebData<'donation'>>(
      await api()
        .post('/api/v1/public/donations')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201),
    );
    const id: string = checkout.body.data.transactionId;
    const pending = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(pending.body.data.paymentAccessCode).toBe('fixture');
    expect(pending.body.data.paymentUrl).toBe(
      `https://checkout.paystack.com/fixture-${id}`,
    );
    expect(pending.body.data.tickets).toHaveLength(0);
    await harness.confirm(id);
    const receipt = typedResponse<WebData<'receipt'>>(
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(200),
    );
    expect(receipt.body.data.status).toBe('SUCCESS');
    expect(receipt.body.data.paymentAccessCode).toBeNull();
    expect(receipt.body.data.paymentUrl).toBeNull();
    expect(receipt.body.data.tickets).toHaveLength(0);
    expect(receipt.body.data.registrations).toHaveLength(0);
    const notificationWhere = {
      recipient: { email: session.email },
      type: notificationConstants.EVENT_MEAL_CLAIM_REMINDER,
    };
    const reminder = await harness.prisma.notification.findFirstOrThrow({
      where: notificationWhere,
    });
    expect(reminder.link).toBe(`/food-bank/${harness.foodBank.id}`);
    expect(reminder.read).toBe(false);
    expect(reminder.message).toContain('no donation is required');
    const replay = typedResponse<WebData<'donation'>>(
      await api()
        .post('/api/v1/public/donations')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201),
    );
    expect(replay.body.data.transactionId).toBe(id);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    expect(
      await harness.prisma.donation.count({ where: { transactionId: id } }),
    ).toBe(1);
    expect(
      await harness.prisma.mealPass.count({
        where: { eventId: harness.foodBank.id, userId: user.id },
      }),
    ).toBe(0);
    await api()
      .get(`/api/v1/public/checkouts/${id}`)
      .auth(session.token, { type: 'bearer' })
      .expect(200);
    expect(
      await harness.prisma.notification.count({ where: notificationWhere }),
    ).toBe(1);
    const auth = harness.module.get(AuthService);
    await auth.signup({
      email: session.email,
      password: 'Meal-reminder-fixture-password!',
    });
    await auth.verifyEmailCode({
      email: session.email,
      code: harness.codes.get(session.email)!,
    });
    const account = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    expect(account.id).toBe(user.id);
    expect(account.isGuest).toBe(false);
    const tray = await harness.module
      .get(NotificationService)
      .getNotificationTray(account.id);
    expect(tray.notifications).toEqual([
      expect.objectContaining({ id: reminder.id, read: false }),
    ]);
    expect(tray.totalUnread).toBe(1);
    await api()
      .post('/api/v1/public/donations')
      .auth(session.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, channel: 'APP' })
      .expect(400);
  });

  it('saves one meal reminder for an existing app account under concurrent payment verification', async () => {
    const address = email();
    const user = await harness.prisma.user.create({
      data: { email: address, isGuest: false, isVerified: true },
    });
    const session = await verify(address);
    expect(session.existingAccount).toBe(true);
    const checkout = typedResponse<WebData<'donation'>>(
      await api()
        .post('/api/v1/public/donations')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ eventId: harness.foodBank.id, amount: 500 })
        .expect(201),
    );
    const id = checkout.body.data.transactionId;
    await harness.confirm(id);
    await Promise.all(
      Array.from({ length: 2 }, () =>
        api()
          .get(`/api/v1/public/checkouts/${id}`)
          .auth(session.token, { type: 'bearer' })
          .expect(200),
      ),
    );
    const where = {
      recipientId: user.id,
      type: notificationConstants.EVENT_MEAL_CLAIM_REMINDER,
    };
    expect(await harness.prisma.notification.count({ where })).toBe(1);
    await harness.prisma.event.update({
      where: { id: harness.ticketEvent.id },
      data: { donationsEnabled: true },
    });
    const ordinaryDonation = typedResponse<WebData<'donation'>>(
      await api()
        .post('/api/v1/public/donations')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ eventId: harness.ticketEvent.id, amount: 500 })
        .expect(201),
    );
    await harness.confirm(ordinaryDonation.body.data.transactionId);
    await api()
      .get(
        `/api/v1/public/checkouts/${ordinaryDonation.body.data.transactionId}`,
      )
      .auth(session.token, { type: 'bearer' })
      .expect(200);
    expect(await harness.prisma.notification.count({ where })).toBe(1);
  });

  it('saves the donation and reminder atomically and keeps the reminder when live delivery fails', async () => {
    const session = await verify();
    const checkout = typedResponse<WebData<'donation'>>(
      await api()
        .post('/api/v1/public/donations')
        .auth(session.token, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send({ eventId: harness.foodBank.id, amount: 500 })
        .expect(201),
    );
    const id = checkout.body.data.transactionId;
    await harness.confirm(id);
    const notifications = harness.module.get(NotificationService);
    const storage = jest
      .spyOn(notifications, 'storeNotification')
      .mockRejectedValueOnce(
        new Error('Test notification storage unavailable'),
      );
    try {
      await api()
        .get(`/api/v1/public/checkouts/${id}`)
        .auth(session.token, { type: 'bearer' })
        .expect(500);
      expect(
        await harness.prisma.donation.count({ where: { transactionId: id } }),
      ).toBe(0);
      expect(
        await harness.prisma.notification.count({
          where: { recipient: { email: session.email } },
        }),
      ).toBe(0);
    } finally {
      storage.mockRestore();
    }
    const delivery = jest
      .spyOn(notifications, 'publishNotifications')
      .mockRejectedValueOnce(new Error('Test live delivery unavailable'));
    try {
      const receipt = typedResponse<WebData<'receipt'>>(
        await api()
          .get(`/api/v1/public/checkouts/${id}`)
          .auth(session.token, { type: 'bearer' })
          .expect(200),
      );
      expect(receipt.body.data.status).toBe('SUCCESS');
    } finally {
      delivery.mockRestore();
    }
    expect(
      await harness.prisma.donation.count({ where: { transactionId: id } }),
    ).toBe(1);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    const tray = await notifications.getNotificationTray(user.id);
    expect(tray.notifications).toEqual([
      expect.objectContaining({
        type: notificationConstants.EVENT_MEAL_CLAIM_REMINDER,
        link: `/food-bank/${harness.foodBank.id}`,
      }),
    ]);
    expect(tray.totalUnread).toBe(1);
  });

  it('retains one native meal entitlement across repeat donations and free claims', async () => {
    const session = await verify();
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    const transactions = harness.module.get(TransactionReferenceService);
    const previousSecret = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'local-test-webhook-secret';
    try {
      for (let index = 0; index < 2; index++) {
        const checkout = await transactions.initiateDonation(
          user.id,
          user.email,
          { eventId: harness.foodBank.id, amount: 500, source: 'FOOD_BANK' },
        );
        await harness.confirm(checkout.transactionId);
        const payload = {
          event: 'charge.success',
          data: { reference: checkout.transactionId },
        };
        const raw = Buffer.from(JSON.stringify(payload));
        const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
          .update(raw)
          .digest('hex');
        await transactions.verifyPayment(payload, signature, raw);
      }
      await harness.module
        .get(FoodBankService)
        .claim(user.id, harness.foodBank.id);
      expect(
        await harness.prisma.notification.count({
          where: {
            recipientId: user.id,
            type: notificationConstants.EVENT_MEAL_CLAIM_REMINDER,
          },
        }),
      ).toBe(0);
      expect(
        await harness.prisma.mealPass.count({
          where: { eventId: harness.foodBank.id, userId: user.id },
        }),
      ).toBe(1);
    } finally {
      if (previousSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousSecret;
    }
  });

  it('collects a volunteer name and links the application to the verified email identity', async () => {
    const session = await verify();
    const path = `/api/v1/public/events/${harness.volunteerEvent.id}/volunteer-roles/${harness.volunteerEvent.volunteerRoles[0].id}/apply`;
    await api()
      .post(path)
      .auth(session.token, { type: 'bearer' })
      .send({ fullName: '' })
      .expect(400);
    const application = typedResponse<WebData<'volunteer'>>(
      await api()
        .post(path)
        .auth(session.token, { type: 'bearer' })
        .send({ fullName: 'Guest Volunteer', note: 'Happy to help.' })
        .expect(201),
    );
    expect(application.body.data.status).toBe('APPLIED');
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
    });
    expect(user.fullName).toBe('Guest Volunteer');
    expect(application.body.data.userId).toBe(user.id);
    const replay = typedResponse<WebData<'volunteer'>>(
      await api()
        .post(path)
        .auth(session.token, { type: 'bearer' })
        .send({ fullName: 'Guest Volunteer' })
        .expect(201),
    );
    expect(replay.body.data.id).toBe(application.body.data.id);
  });
});

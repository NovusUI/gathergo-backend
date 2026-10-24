import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PaymentProvider, PaymentType } from '@prisma/client';
import { randomUUID, createHmac } from 'crypto';
import { TransactionReferenceService } from '../transaction-reference/transaction-reference.service';
import { AlatCollectionService } from '../transaction-reference/alat-collection.service';
import { DonationService } from '../donation/donation.service';
import { PaystackService } from '../paystack/paystack.service';
import { CheckoutWorker } from './checkout.worker';
import { PrismaService } from 'src/prisma/prisma.service';
import { TicketService } from '../ticket/ticket.service';
import { RegistrationService } from '../registration/registration.service';
import { NotificationService } from '../notification/notification.service';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';
import { buildPricingSummary } from '../transaction-reference/payment-pricing.util';
import { CheckoutService } from './checkout.service';
import { CheckoutMetadata, CheckoutRecord } from './checkout.types';
import {
  assertTicketCapacityEdit,
  lockCheckoutEvent,
} from './checkout-inventory';

const databaseUrl = process.env.CHECKOUT_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('checkout concurrency (isolated PostgreSQL)', () => {
  const prisma = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  let checkout: CheckoutService;
  let tickets: TicketService;
  let payments: TransactionReferenceService;
  let worker: CheckoutWorker;
  const alat = { getTransactionStatus: jest.fn() };
  const paystack = {
    initializeTransaction: jest.fn(),
    verifyTransaction: jest.fn(),
    listRefunds: jest.fn(),
    createRefund: jest.fn(),
  };
  let eventId: string;
  let ticketId: string;
  let users: string[];

  beforeAll(async () => {
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname) ||
      !new URL(databaseUrl).pathname.includes('checkout_hardening')
    )
      throw new Error(
        'Use an isolated local checkout_hardening test database.',
      );
    const module = await Test.createTestingModule({
      providers: [
        CheckoutService,
        TransactionReferenceService,
        CheckoutWorker,
        { provide: PaystackService, useValue: paystack },
        { provide: AlatCollectionService, useValue: alat },
        { provide: DonationService, useValue: {} },
        TicketService,
        RegistrationService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CHECKOUT_HOLD_SECONDS: 300,
            CHECKOUT_MAX_TICKETS: 4,
          }),
        },
        {
          provide: NotificationService,
          useValue: {
            createNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FeedIntegrationService,
          useValue: {
            onTicketPurchaseBatch: jest.fn().mockResolvedValue(undefined),
            onRegistrationCompleted: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendTicketConfirmation: jest
              .fn()
              .mockResolvedValue({ skipped: false }),
            sendRegistrationConfirmation: jest
              .fn()
              .mockResolvedValue({ skipped: false }),
          },
        },
      ],
    }).compile();
    checkout = module.get(CheckoutService);
    payments = module.get(TransactionReferenceService);
    worker = module.get(CheckoutWorker);
    tickets = module.get(TicketService);
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    paystack.initializeTransaction.mockImplementation(
      (input: { reference: string }) =>
        Promise.resolve({
          status: true,
          message: 'Initialized',
          data: {
            reference: input.reference,
            authorization_url: `https://checkout.paystack.com/${input.reference}`,
            access_code: 'test-access',
          },
        }),
    );
    await prisma.checkoutFulfillmentJob.deleteMany();
    await prisma.checkoutRefund.deleteMany();
    users = await Promise.all(
      Array.from(
        { length: 12 },
        async () =>
          (
            await prisma.user.create({
              data: { email: `${randomUUID()}@checkout.test` },
            })
          ).id,
      ),
    );
    const event = await prisma.event.create({
      data: {
        title: 'Concurrent checkout test',
        creatorId: users[0],
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
        registrationType: 'ticket',
        links: [],
        tags: [],
      },
    });
    eventId = event.id;
    ticketId = (
      await prisma.eventTicket.create({
        data: {
          eventId,
          type: 'General',
          description: '',
          perks: [],
          price: 1000,
          quantity: 1,
        },
      })
    ).id;
  });

  async function start(
    userId: string,
    options: {
      key?: string;
      quantity?: number;
      free?: boolean;
      registration?: boolean;
      sponsored?: boolean;
    } = {},
  ) {
    const type = options.registration
      ? PaymentType.REGISTRATION
      : PaymentType.TICKET;
    const quantity = options.quantity ?? 1;
    const pricing = buildPricingSummary(
      options.free ? 0 : 100000 * quantity,
      PaymentProvider.PAYSTACK,
    );
    const item = { eventTicketId: ticketId, ticketName: 'General', quantity };
    const metadata: CheckoutMetadata = {
      type,
      eventId,
      eventTitle: 'Concurrent checkout test',
      amountUnit: 'KOBO',
      pricing,
      ...(options.registration
        ? {}
        : options.free
          ? { freeTickets: [item] }
          : {
              paidTickets: [
                {
                  ...item,
                  totalPriceKobo: 100000 * quantity,
                  totalPriceNaira: 1000 * quantity,
                },
              ],
            }),
      ...(options.sponsored
        ? {
            sponsorship: {
              beneficiaryType: 'SPONSORED',
              status: 'PENDING_PAYMENT',
            },
          }
        : {}),
    };
    return checkout.create({
      userId,
      eventId,
      idempotencyKey: options.key ?? randomUUID(),
      requestHash: checkout.hashRequest({
        type,
        quantity,
        free: !!options.free,
        sponsored: !!options.sponsored,
      }),
      paymentType: type,
      provider: PaymentProvider.PAYSTACK,
      metadata,
      data: {
        creatorId: users[0],
        amount: pricing.chargeAmountKobo,
      },
    });
  }
  async function pay(record: CheckoutRecord) {
    return checkout.complete({
      transactionId: record.id,
      amountKobo: record.amount,
      providerTransactionId: '1234',
      providerPayload: {},
      providerFeeKobo: 0,
      pricing: checkout.metadata(record).pricing,
      settlementStatus: 'READY',
    });
  }
  async function expire(record: CheckoutRecord) {
    await prisma.checkoutReservation.update({
      where: { transactionId: record.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }

  it('allows only one buyer to hold the last ticket', async () => {
    const attempts = await Promise.allSettled(
      users.slice(1).map((user) => start(user)),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.checkoutReservationItem.aggregate({
        where: { eventTicketId: ticketId },
        _sum: { quantity: true },
      }),
    ).toMatchObject({ _sum: { quantity: 1 } });
  });
  it('replays simultaneous identical requests with a fixed deadline', async () => {
    const key = randomUUID();
    const records = await Promise.all(
      Array.from({ length: 30 }, () => start(users[1], { key })),
    );
    expect(new Set(records.map((record) => record.id)).size).toBe(1);
    expect(
      new Set(records.map((record) => record.reservation!.expiresAt.getTime()))
        .size,
    ).toBe(1);
  });
  it('rejects changed payloads with the same key and limits checkout to four tickets', async () => {
    const key = randomUUID();
    await start(users[1], { key });
    await expect(start(users[1], { key, quantity: 2 })).rejects.toThrow(
      'different order',
    );
    await expect(start(users[2], { quantity: 5 })).rejects.toThrow(
      'between 1 and 4',
    );
  });
  it('allows only one active checkout per buyer and event', async () => {
    await prisma.eventTicket.update({
      where: { id: ticketId },
      data: { quantity: 10 },
    });
    await start(users[1]);
    await expect(start(users[1])).rejects.toThrow('active checkout');
  });
  it('fulfills concurrent confirmations exactly once', async () => {
    const record = await start(users[1]);
    await Promise.all(Array.from({ length: 20 }, () => pay(record)));
    expect(
      await prisma.ticket.count({ where: { transactionId: record.id } }),
    ).toBe(1);
    expect(
      (await prisma.eventTicket.findUniqueOrThrow({ where: { id: ticketId } }))
        .sold,
    ).toBe(1);
    expect(
      await prisma.checkoutFulfillmentJob.count({
        where: { transactionId: record.id },
      }),
    ).toBe(1);
  });
  it('rolls back issuance and stock together, then retries successfully', async () => {
    const record = await start(users[1]);
    const failure = jest
      .spyOn(tickets, 'issue')
      .mockImplementationOnce(async (...args) => {
        await TicketService.prototype.issue(...args);
        throw new Error('after insert');
      });
    await expect(pay(record)).rejects.toThrow('after insert');
    expect(
      await prisma.ticket.count({ where: { transactionId: record.id } }),
    ).toBe(0);
    expect((await checkout.get(record.id)).status).toBe('PENDING');
    failure.mockRestore();
    await pay(record);
    expect(
      await prisma.ticket.count({ where: { transactionId: record.id } }),
    ).toBe(1);
  });
  it('makes expired capacity available without waiting for cleanup', async () => {
    const first = await start(users[1]);
    await expire(first);
    const next = await start(users[2]);
    expect(next.reservation!.status).toBe('HELD');
    const late = await pay(first);
    expect(late.status).toBe('REFUND_REQUIRED');
    expect(late.creatorPayable).toBe(0);
    expect(late.refund!.amountKobo).toBe(first.amount);
    expect(
      await prisma.ticket.count({ where: { transactionId: first.id } }),
    ).toBe(0);
  });
  it('accepts a late payment when capacity is still available', async () => {
    const record = await start(users[1]);
    await expire(record);
    await checkout.expireHolds();
    expect((await pay(record)).status).toBe('SUCCESS');
  });
  it('releases cancelled holds and refunds a payment arriving after cancellation', async () => {
    const first = await start(users[1]);
    await checkout.cancel(first.id, users[1]);
    await start(users[2]);
    expect((await pay(first)).status).toBe('REFUND_REQUIRED');
    await expect(checkout.cancel(first.id, users[2])).rejects.toThrow(
      'not found',
    );
  });
  it('lets the same buyer restart after cancellation with a fresh checkout key', async () => {
    const originalKey = randomUUID();
    const first = await start(users[1], { key: originalKey });
    const cancelled = await payments.cancelCheckout(first.id, users[1]);
    expect(cancelled).toMatchObject({
      transactionId: first.id,
      checkoutStatus: 'EXPIRED',
      reservationStatus: 'CANCELLED',
      paymentUrl: null,
      reservationExpiresAt: null,
    });
    const replay = await start(users[1], { key: originalKey });
    expect(replay.id).toBe(first.id);
    expect(replay.reservation?.status).toBe('CANCELLED');

    const retry = await start(users[1]);
    expect(retry.id).not.toBe(first.id);
    expect(retry.reservation?.status).toBe('HELD');
    expect((await pay(retry)).status).toBe('SUCCESS');
    expect(
      await prisma.ticket.count({
        where: { userId: users[1], eventTicketId: ticketId },
      }),
    ).toBe(1);
  });
  it('issues free tickets immediately and prevents concurrent overselling', async () => {
    await prisma.eventTicket.update({
      where: { id: ticketId },
      data: { price: 0 },
    });
    const attempts = await Promise.allSettled(
      users.slice(1).map((user) => start(user, { free: true })),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      await prisma.ticket.count({ where: { eventTicketId: ticketId } }),
    ).toBe(1);
  });
  it('protects registration capacity and same-buyer free registration', async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        registrationType: 'registration',
        registrationAttendees: 1,
        registrationFee: 0,
      },
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        start(users[1], { free: true, registration: true }),
      ),
    );
    expect(
      attempts.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    await expect(
      start(users[2], { free: true, registration: true }),
    ).rejects.toThrow('No registration spaces');
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
  });
  it('counts sponsored seats against registration capacity', async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        registrationType: 'registration',
        registrationAttendees: 1,
        registrationFee: 1000,
      },
    });
    const record = await start(users[1], {
      registration: true,
      sponsored: true,
    });
    await pay(record);
    await expect(start(users[2], { registration: true })).rejects.toThrow(
      'No registration spaces',
    );
    expect(await prisma.registration.count({ where: { eventId } })).toBe(0);
  });
  it('prevents reducing capacity below active holds', async () => {
    await start(users[1]);
    await expect(
      prisma.$transaction(async (tx) => {
        await lockCheckoutEvent(tx, eventId);
        await assertTicketCapacityEdit(tx, ticketId, 0);
      }),
    ).rejects.toThrow('reserved');
  });
  it('refunds mismatched payment amounts without issuing admissions', async () => {
    const record = await start(users[1]);
    const result = await checkout.complete({
      transactionId: record.id,
      amountKobo: record.amount - 1,
      providerPayload: {},
      providerFeeKobo: 0,
      pricing: checkout.metadata(record).pricing,
      settlementStatus: 'READY',
    });
    expect(result.status).toBe('REFUND_REQUIRED');
    expect(
      await prisma.ticket.count({ where: { transactionId: record.id } }),
    ).toBe(0);
  });
  it('retries an inbox event after fulfillment fails and marks it processed only after commit', async () => {
    const record = await start(users[1]);
    const payload = {
      event: 'charge.success',
      data: { reference: record.id, amount: 1 },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    const previousSecret = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'checkout-test-secret';
    const signature = createHmac('sha512', 'checkout-test-secret')
      .update(raw)
      .digest('hex');
    paystack.verifyTransaction.mockResolvedValue({
      status: true,
      message: 'Verified',
      data: {
        id: 1234,
        reference: record.id,
        amount: record.amount,
        fees: 0,
        currency: 'NGN',
        status: 'success',
      },
    });
    const failure = jest
      .spyOn(checkout, 'complete')
      .mockRejectedValueOnce(new Error('database retry'));
    try {
      await expect(
        payments.verifyPayment(payload, signature, raw),
      ).rejects.toThrow('database retry');
      expect(
        (
          await prisma.providerWebhookEvent.findUniqueOrThrow({
            where: { eventKey: `paystack:charge.success:${record.id}` },
          })
        ).processedAt,
      ).toBeNull();
      await payments.verifyPayment(payload, signature, raw);
      expect(
        (
          await prisma.providerWebhookEvent.findUniqueOrThrow({
            where: { eventKey: `paystack:charge.success:${record.id}` },
          })
        ).processedAt,
      ).not.toBeNull();
      expect(
        await prisma.ticket.count({ where: { transactionId: record.id } }),
      ).toBe(1);
      expect((await checkout.get(record.id)).amount).toBe(record.amount); // Uses verified provider amount, not the callback's 1 kobo.
    } finally {
      failure.mockRestore();
      if (previousSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
      else process.env.PAYSTACK_SECRET_KEY = previousSecret;
    }
  });

  it('keeps status and passes private to their buyer', async () => {
    const record = await start(users[1]);
    await pay(record);
    await expect(
      payments.getTransactionStatus(record.id, users[2]),
    ).rejects.toThrow('not found');
    await expect(
      payments.getTicketOrRegistrationByTrasactionId(
        record.id,
        'TICKET',
        users[2],
      ),
    ).rejects.toThrow('not found');
  });

  it('retries confirmation delivery without issuing more passes', async () => {
    const record = await start(users[1]);
    await pay(record);
    const notification = jest
      .spyOn(tickets, 'notifyPurchase')
      .mockRejectedValueOnce(new Error('mail queue unavailable'))
      .mockResolvedValue(undefined);
    try {
      await worker.deliverConfirmations();
      expect(
        (
          await prisma.checkoutFulfillmentJob.findUniqueOrThrow({
            where: { transactionId: record.id },
          })
        ).status,
      ).toBe('PENDING');
      await prisma.checkoutFulfillmentJob.update({
        where: { transactionId: record.id },
        data: { nextAttemptAt: new Date(0) },
      });
      await worker.deliverConfirmations();
      expect(
        (
          await prisma.checkoutFulfillmentJob.findUniqueOrThrow({
            where: { transactionId: record.id },
          })
        ).status,
      ).toBe('COMPLETED');
      expect(
        await prisma.ticket.count({ where: { transactionId: record.id } }),
      ).toBe(1);
    } finally {
      notification.mockRestore();
    }
  });

  it('does not submit a second refund after an ambiguous provider timeout', async () => {
    const record = await start(users[1]);
    await checkout.cancel(record.id, users[1]);
    await pay(record);
    paystack.listRefunds.mockResolvedValue({ status: true, data: [] });
    paystack.createRefund.mockRejectedValueOnce(new Error('provider timeout'));
    await worker.processRefunds();
    expect((await checkout.get(record.id)).refund!.status).toBe(
      'MANUAL_REQUIRED',
    );
    await prisma.checkoutRefund.update({
      where: { transactionId: record.id },
      data: { nextAttemptAt: new Date(0) },
    });
    paystack.listRefunds.mockResolvedValue({
      status: true,
      data: [
        { id: 99, status: 'processed', currency: 'NGN', amount: record.amount },
      ],
    });
    await worker.processRefunds();
    expect(paystack.createRefund).toHaveBeenCalledTimes(1);
    expect((await checkout.get(record.id)).status).toBe('REFUNDED');
  });

  it('tracks ALAT refunds for operations rather than pretending to refund', async () => {
    let record = await start(users[1]);
    await prisma.transactionReference.update({
      where: { id: record.id },
      data: { paymentProvider: PaymentProvider.ALAT_TRANSFER },
    });
    record = await checkout.get(record.id);
    await checkout.cancel(record.id, users[1]);
    await pay(record);
    await worker.processRefunds();
    expect((await checkout.get(record.id)).refund!.status).toBe(
      'MANUAL_REQUIRED',
    );
    expect((await checkout.get(record.id)).status).toBe('REFUND_REQUIRED');
    expect(paystack.createRefund).not.toHaveBeenCalled();
  });
  it('persists the provider checkout and replays it without extending the reservation', async () => {
    const key = randomUUID();
    const request = {
      items: [{ id: ticketId, ticketName: 'Client label', quantity: 1 }],
    };
    const first = await payments.initiate(
      users[1],
      'buyer@checkout.test',
      request,
      key,
    );
    const replay = await payments.initiate(
      users[1],
      'buyer@checkout.test',
      request,
      key,
    );
    expect(replay.transactionId).toBe(first.transactionId);
    expect(replay.paymentUrl).toBe(first.paymentUrl);
    expect(replay.reservationExpiresAt).toBe(first.reservationExpiresAt);
    expect(paystack.initializeTransaction).toHaveBeenCalledTimes(1);
    expect((await checkout.get(first.transactionId)).initializationStatus).toBe(
      'READY',
    );
  });

  it('replaces an unpaid order with revised quantities and additional ticket types', async () => {
    await prisma.eventTicket.update({
      where: { id: ticketId },
      data: { quantity: 10 },
    });
    const vip = await prisma.eventTicket.create({
      data: {
        eventId,
        type: 'VIP',
        description: '',
        perks: [],
        quantity: 10,
        price: 2000,
      },
    });
    const buyer = users[1];
    const email = 'buyer@checkout.test';
    const first = await payments.initiate(
      buyer,
      email,
      { items: [{ id: ticketId, ticketName: 'General', quantity: 1 }] },
      randomUUID(),
    );
    const revised = {
      items: [
        { id: ticketId, ticketName: 'General', quantity: 2 },
        { id: vip.id, ticketName: 'VIP', quantity: 1 },
      ],
    };
    const revisedKey = randomUUID();
    await expect(
      payments.initiate(buyer, email, revised, revisedKey),
    ).rejects.toMatchObject({
      response: { transactionId: first.transactionId },
      status: 409,
    });
    await payments.cancelCheckout(first.transactionId, buyer);
    const updated = await payments.initiate(buyer, email, revised, revisedKey);
    expect(updated.transactionId).not.toBe(first.transactionId);
    expect(updated.pricing.grossAmountKobo).toBe(400000);
    expect(updated.paymentUrl).toBe(
      `https://checkout.paystack.com/${updated.transactionId}`,
    );
    const original = await checkout.get(first.transactionId);
    expect(original.reservation?.status).toBe('CANCELLED');
    const current = await checkout.get(updated.transactionId);
    expect(current.reservation?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventTicketId: ticketId, quantity: 2 }),
        expect.objectContaining({ eventTicketId: vip.id, quantity: 1 }),
      ]),
    );
    expect((await pay(current)).status).toBe('SUCCESS');
    expect(
      await prisma.ticket.count({
        where: { transactionId: updated.transactionId },
      }),
    ).toBe(3);
    expect(
      await prisma.ticket.count({
        where: { transactionId: first.transactionId },
      }),
    ).toBe(0);
  });

  it('releases capacity after provider initialization fails and requires a fresh checkout key', async () => {
    const key = randomUUID();
    paystack.initializeTransaction.mockRejectedValueOnce(
      new Error('provider unavailable'),
    );
    const request = {
      items: [{ id: ticketId, ticketName: 'General', quantity: 1 }],
    };
    await expect(
      payments.initiate(users[1], 'buyer@checkout.test', request, key),
    ).rejects.toThrow('provider unavailable');
    const replay = await payments.initiate(
      users[1],
      'buyer@checkout.test',
      request,
      key,
    );
    expect(replay.checkoutStatus).toBe('EXPIRED');
    expect(replay.paymentUrl).toBeNull();
    expect(paystack.initializeTransaction).toHaveBeenCalledTimes(1);
    expect((await start(users[2])).reservation!.status).toBe('HELD');
  });

  it('initializes one free registration and immediately replays its confirmed result', async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        registrationType: 'registration',
        registrationAttendees: 1,
        registrationFee: 0,
      },
    });
    const key = randomUUID();
    const first = await payments.initiateRegistration(
      users[1],
      'buyer@checkout.test',
      eventId,
      key,
    );
    const replay = await payments.initiateRegistration(
      users[1],
      'buyer@checkout.test',
      eventId,
      key,
    );
    expect(first.checkoutStatus).toBe('SUCCESS');
    expect(replay.transactionId).toBe(first.transactionId);
    expect(await prisma.registration.count({ where: { eventId } })).toBe(1);
    expect(paystack.initializeTransaction).not.toHaveBeenCalled();
  });
  it('releases a provider-confirmed failed checkout immediately', async () => {
    const record = await start(users[1]);
    await prisma.transactionReference.update({
      where: { id: record.id },
      data: {
        paymentProvider: PaymentProvider.ALAT_TRANSFER,
        status: 'AWAITING_TRANSFER',
        providerReference: 'alat-test-payment',
      },
    });
    alat.getTransactionStatus.mockResolvedValue({
      status: 'FAILED',
      providerReference: 'alat-test-payment',
      reference: record.id,
      amountKobo: null,
      feeAmountKobo: null,
      payload: { status: 'FAILED' },
    });
    expect(
      (await payments.getTransactionStatus(record.id, users[1])).status,
    ).toBe('FAILED');
    expect((await checkout.get(record.id)).reservation!.status).toBe('EXPIRED');
    expect((await start(users[2])).reservation!.status).toBe('HELD');
  });
});

import 'reflect-metadata';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { PublicWebController } from '../src/modules/public-web/public-web.controller';
import { PublicWebService } from '../src/modules/public-web/public-web.service';
import { WebSessionService } from '../src/modules/public-web/web-session.service';
import { WebSessionGuard } from '../src/modules/public-web/web-session.guard';
import { TransactionReferenceService } from '../src/modules/transaction-reference/transaction-reference.service';
import { AlatCollectionService } from '../src/modules/transaction-reference/alat-collection.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';
import { DonationService } from '../src/modules/donation/donation.service';
import { RegistrationService } from '../src/modules/registration/registration.service';
import { TicketService } from '../src/modules/ticket/ticket.service';
import { VolunteerService } from '../src/modules/volunteer/volunteer.service';
import { FoodBankService } from '../src/modules/food-bank/food-bank.service';
import {
  MailService,
  EmailVerificationCodeData,
} from '../src/modules/mail/mail.service';
import { PaystackService } from '../src/modules/paystack/paystack.service';
import type { PaystackVerifiedTransaction } from '../src/modules/paystack/types/paystack-response.type';
import { NotificationService } from '../src/modules/notification/notification.service';
import { NotificationsService } from '../src/modules/background-notification/backgroundnotification.service';
import { RedisService } from '../src/redis/redis.service';
import { RedisPubSubService } from '../src/redis/redis.pubsub.service';
import { FeedIntegrationService } from '../src/modules/feed/feed-integration.service';
import { WalletService } from '../src/modules/wallet/service/wallet.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { FirebaseService } from '../src/modules/firebase/firebase.service';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptors';

export async function createPublicWebHarness(
  options: {
    rateLimits?: boolean;
    onCode?: (mail: EmailVerificationCodeData) => void;
  } = {},
) {
  const url = process.env.PUBLIC_WEB_TEST_DATABASE_URL;
  if (
    !url ||
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    new URL(url).pathname !== '/gathergo_public_web_test'
  )
    throw new Error(
      'Set PUBLIC_WEB_TEST_DATABASE_URL to the dedicated local gathergo_public_web_test database.',
    );
  const prisma = new PrismaService({ datasourceUrl: url });
  const codes = new Map<string, string>();
  const payments = new Map<string, PaystackVerifiedTransaction>();
  const unreadCounts = new Map<string, number>();
  const initializations: Parameters<
    PaystackService['initializeTransaction']
  >[0][] = [];
  const paid = { skipped: false, queued: true };
  const mail = {
    sendEmailVerificationCode: (data: EmailVerificationCodeData) => {
      codes.set(String(data.to), data.code);
      options.onCode?.(data);
      return Promise.resolve(paid);
    },
    sendDonationConfirmation: () => Promise.resolve(paid),
    sendTicketConfirmation: () => Promise.resolve(paid),
    sendRegistrationConfirmation: () => Promise.resolve(paid),
    sendWelcomeEmail: () => Promise.resolve(paid),
  };
  const moduleBuilder = Test.createTestingModule({
    controllers: [PublicWebController, AuthController],
    providers: [
      PublicWebService,
      WebSessionService,
      WebSessionGuard,
      RateLimitGuard,
      TransactionReferenceService,
      CheckoutService,
      DonationService,
      TicketService,
      RegistrationService,
      VolunteerService,
      FoodBankService,
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: MailService, useValue: mail },
      {
        provide: ConfigService,
        useValue: new ConfigService({
          CHECKOUT_HOLD_SECONDS: 300,
          CHECKOUT_MAX_TICKETS: 4,
        }),
      },
      { provide: JwtService, useValue: new JwtService() },
      { provide: FirebaseService, useValue: {} },
      NotificationService,
      {
        provide: RedisService,
        useValue: {
          client: {
            incr: (key: string) => {
              const count = (unreadCounts.get(key) ?? 0) + 1;
              unreadCounts.set(key, count);
              return Promise.resolve(count);
            },
            get: (key: string) =>
              Promise.resolve(
                unreadCounts.has(key) ? String(unreadCounts.get(key)) : null,
              ),
            set: (key: string, value: number) => {
              unreadCounts.set(key, value);
              return Promise.resolve('OK');
            },
          },
        },
      },
      {
        provide: RedisPubSubService,
        useValue: { publishNotification: () => Promise.resolve(undefined) },
      },
      {
        provide: NotificationsService,
        useValue: { sendRegularNotification: () => Promise.resolve(undefined) },
      },
      {
        provide: FeedIntegrationService,
        useValue: {
          onDonationMade: () => Promise.resolve(undefined),
          onTicketPurchaseBatch: () => Promise.resolve(undefined),
          onRegistrationCompleted: () => Promise.resolve(undefined),
        },
      },
      {
        provide: WalletService,
        useValue: {
          refreshCreatorSettlementStatus: () => Promise.resolve(undefined),
        },
      },
      { provide: AlatCollectionService, useValue: {} },
      {
        provide: PaystackService,
        useValue: {
          initializeTransaction: (
            input: Parameters<PaystackService['initializeTransaction']>[0],
          ) => {
            initializations.push(input);
            return Promise.resolve({
              status: true,
              message: 'Test provider initialized',
              data: {
                reference: input.reference,
                access_code: 'fixture',
                authorization_url: `https://checkout.paystack.com/fixture-${input.reference}`,
              },
            });
          },
          verifyTransaction: (id: string) =>
            Promise.resolve({
              status: true,
              message: 'Test provider response',
              data: payments.get(id) ?? { reference: id, status: 'pending' },
            }),
        },
      },
    ],
  });
  if (options.rateLimits === false)
    moduleBuilder
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true });
  const module = await moduleBuilder.compile();
  const app = module.createNestApplication<INestApplication<Server>>();
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
  const creator = await prisma.user.create({
    data: {
      email: `organiser-${randomUUID()}@example.test`,
      fullName: 'GatherGo Community',
      createdAt: new Date('2020-01-01'),
      isVerified: true,
    },
  });
  const startDate = new Date(Date.now() + 86400000);
  const endDate = new Date(startDate.getTime() + 14400000);
  const common = {
    creatorId: creator.id,
    startDate,
    endDate,
    isPhysicalEvent: true,
    location: 'Community Hall, Lagos',
    description:
      'A community gathering with a shared purpose. Join us and be part of something good.',
    links: [],
    tags: [],
  };
  const ticketEvent = await prisma.event.create({
    data: {
      ...common,
      title: 'Gather for good',
      registrationType: 'ticket',
      eventTickets: {
        create: [
          {
            type: 'Community pass',
            description: 'Your place at our community gathering.',
            price: 0,
            quantity: 20,
            perks: ['Event access'],
          },
          {
            type: 'Supporter pass',
            description: 'Support the gathering.',
            price: 1000,
            quantity: 20,
            perks: ['Event access'],
          },
        ],
      },
    },
    include: { eventTickets: true },
  });
  const registrationEvent = await prisma.event.create({
    data: {
      ...common,
      title: 'Community connection day',
      registrationType: 'registration',
      registrationFee: 0,
      registrationAttendees: 20,
    },
  });
  const foodBank = await prisma.event.create({
    data: {
      ...common,
      title: 'A meal, with dignity',
      registrationType: 'foodbank',
      donationsEnabled: true,
      foodBankTotalMeals: 100,
      foodBankSlotCapacity: 10,
      foodBankSlotMinutes: 15,
      foodBankCollectionStatus: 'NOT_STARTED',
      foodBankTimeZone: 'Africa/Lagos',
    },
  });
  const volunteerEvent = await prisma.event.create({
    data: {
      ...common,
      title: 'Give your time, grow our community',
      registrationType: 'volunteer',
      impactTitle: 'A stronger neighbourhood',
      impactDescription: 'Bring your skills to our next community project.',
      volunteerRoles: {
        create: {
          title: 'Community welcome team',
          description: 'Welcome guests and help everyone feel at home.',
          capacity: 5,
          requiresApproval: true,
        },
      },
    },
    include: { volunteerRoles: true },
  });
  const ride = await prisma.carpool.create({
    data: {
      eventId: ticketEvent.id,
      driverId: creator.id,
      origin: 'Ikeja',
      destination: 'Community Hall, Lagos',
      departureTime: '09:00',
      availableSeats: 3,
    },
  });
  const confirm = async (id: string) => {
    const transaction = await prisma.transactionReference.findUniqueOrThrow({
      where: { id },
    });
    payments.set(id, {
      id: 123456,
      reference: id,
      status: 'success',
      amount: transaction.amount,
      currency: 'NGN',
      fees: 0,
    });
  };
  return {
    app,
    prisma,
    codes,
    initializations,
    confirm,
    module,
    creator,
    ticketEvent,
    registrationEvent,
    foodBank,
    volunteerEvent,
    ride,
  };
}

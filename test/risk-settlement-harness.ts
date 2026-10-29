import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptors';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';
import { DashboardAuthController } from '../src/modules/dashboard-auth/dashboard-auth.controller';
import { DashboardAuthGuard } from '../src/modules/dashboard-auth/dashboard-auth.guard';
import { DashboardAuthService } from '../src/modules/dashboard-auth/dashboard-auth.service';
import { DashboardController } from '../src/modules/dashboard/controllers/dashboard.controller';
import { DashboardService } from '../src/modules/dashboard/services/dashboard.service';
import { WalletController } from '../src/modules/wallet/controller/wallet.controller';
import { WalletService } from '../src/modules/wallet/service/wallet.service';
import { DikriptService } from '../src/modules/wallet/service/dikript.service';
import { PaystackService } from '../src/modules/paystack/paystack.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { TransactionReferenceController } from '../src/modules/transaction-reference/transaction-reference.controller';
import { TransactionReferenceService } from '../src/modules/transaction-reference/transaction-reference.service';
import { AlatCollectionService } from '../src/modules/transaction-reference/alat-collection.service';
import { DonationService } from '../src/modules/donation/donation.service';
import { TicketService } from '../src/modules/ticket/ticket.service';
import { RegistrationService } from '../src/modules/registration/registration.service';
import { CheckoutService } from '../src/modules/checkout/checkout.service';

export const riskFixture = {
  creatorId: 'risk-qa-creator',
  buyerId: 'risk-qa-buyer',
  eventId: 'risk-qa-event',
  paidId: 'risk-qa-success',
  pendingId: 'risk-qa-pending',
  legacyId: 'risk-qa-legacy',
};

export async function createRiskSettlementHarness() {
  const databaseUrl = process.env.RISK_SETTLEMENT_TEST_DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      'Set RISK_SETTLEMENT_TEST_DATABASE_URL to an isolated local test database.',
    );
  const url = new URL(databaseUrl);
  if (
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/gathergo_risk_settlement_test'
  )
    throw new Error(
      'Risk/settlement tests require the dedicated local gathergo_risk_settlement_test database.',
    );
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const passwordHash = await hash('Fixture-password-2026!', 12);
  for (const role of ['ADMIN', 'USER'] as const) {
    const username = role === 'ADMIN' ? 'qa.admin' : 'qa.reader';
    await prisma.dashboardUser.upsert({
      where: { username },
      create: {
        username,
        fullName: role === 'ADMIN' ? 'QA Administrator' : 'QA Reader',
        passwordHash,
        role,
        mustChangePassword: false,
      },
      update: {
        passwordHash,
        role,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
  }
  const module = await Test.createTestingModule({
    controllers: [
      DashboardAuthController,
      DashboardController,
      WalletController,
      TransactionReferenceController,
    ],
    providers: [
      Reflector,
      RateLimitGuard,
      DashboardAuthGuard,
      DashboardAuthService,
      DashboardService,
      WalletService,
      TransactionReferenceService,
      { provide: PrismaService, useValue: prisma },
      ...[
        DikriptService,
        PaystackService,
        NotificationService,
        AlatCollectionService,
        DonationService,
        TicketService,
        RegistrationService,
        CheckoutService,
      ].map((provide) => ({ provide, useValue: {} })),
    ],
  }).compile();
  const app = module.createNestApplication<INestApplication<App>>();
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: 'http://127.0.0.1:5174' });
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

  async function seed() {
    const { creatorId, buyerId, eventId, paidId, pendingId, legacyId } =
      riskFixture;
    await prisma.settlementAllocation.deleteMany({
      where: { settlement: { creatorId } },
    });
    await prisma.settlementRecord.deleteMany({ where: { creatorId } });
    await prisma.transactionReference.deleteMany({
      where: { userId: buyerId },
    });
    await prisma.creatorKycVerification.deleteMany({
      where: { userId: creatorId },
    });
    await prisma.creatorSettlementProfile.deleteMany({
      where: { userId: creatorId },
    });
    await prisma.event.deleteMany({ where: { creatorId } });
    await prisma.user.deleteMany({
      where: { id: { in: [creatorId, buyerId] } },
    });
    await prisma.user.createMany({
      data: [
        {
          id: creatorId,
          email: 'risk-host@example.test',
          username: 'risk.host',
          fullName: 'Test Event Creator',
        },
        {
          id: buyerId,
          email: 'risk-buyer@example.test',
          username: 'risk.buyer',
          fullName: 'Test Buyer',
        },
      ],
    });
    await prisma.event.create({
      data: {
        id: eventId,
        title: 'Community fundraiser',
        creatorId,
        registrationType: 'donation',
        isPhysicalEvent: true,
        location: 'Lagos',
        startDate: new Date('2026-11-01T10:00:00Z'),
        endDate: new Date('2026-11-01T12:00:00Z'),
      },
    });
    const profile = await prisma.creatorSettlementProfile.create({
      data: {
        userId: creatorId,
        status: 'PENDING_KYC',
        accountOwnershipType: 'PERSONAL',
        bankName: 'Test Bank',
        accountName: 'Test Event Creator',
        accountNumber: '0000001234',
        accountNumberMasked: '******1234',
        kycStatus: 'SUBMITTED',
        nameMatchStatus: 'MATCHED',
        metadata: { kycTier: 'NONE' },
      },
    });
    await prisma.creatorKycVerification.create({
      data: {
        userId: creatorId,
        settlementProfileId: profile.id,
        accountOwnershipType: 'PERSONAL',
        status: 'SUBMITTED',
        identityStatus: 'VERIFIED',
        livenessStatus: 'VERIFIED',
        nameMatchStatus: 'MATCHED',
        metadata: { kycTier: 'NONE' },
      },
    });
    const pricing = {
      chargeAmountKobo: 525000,
      grossAmountKobo: 500000,
      creatorPayableKobo: 500000,
      platformFeeKobo: 12500,
    };
    await prisma.transactionReference.createMany({
      data: [
        {
          id: paidId,
          userId: buyerId,
          creatorId,
          eventId,
          paymentType: 'DONATION',
          status: 'SUCCESS',
          riskStatus: 'HOLD',
          settlementStatus: 'HELD_KYC',
          amount: 525000,
          creatorPayable: 500000,
          platformFee: 12500,
          providerFee: 12500,
          metadata: { amountUnit: 'KOBO', pricing },
          fulfilledAt: new Date(),
        },
        {
          id: pendingId,
          userId: buyerId,
          creatorId,
          eventId,
          paymentType: 'DONATION',
          status: 'PENDING',
          riskStatus: 'REVIEW',
          settlementStatus: 'READY',
          amount: 525000,
          creatorPayable: 500000,
          platformFee: 12500,
          providerFee: 12500,
          metadata: { amountUnit: 'KOBO', pricing },
        },
        {
          id: legacyId,
          userId: buyerId,
          eventId,
          paymentType: 'DONATION',
          status: 'SUCCESS',
          riskStatus: 'CLEAR',
          settlementStatus: 'HELD_RISK',
          amount: 1000,
          creatorPayable: 85000,
          platformFee: 10000,
          providerFee: 5000,
          metadata: {},
        },
      ],
    });
  }
  return {
    app,
    prisma,
    seed,
    wallet: module.get(WalletService),
    risk: module.get(TransactionReferenceService),
  };
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentProvider, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { collectionAvailability } from '../food-bank/collection-policy';
import { getCheckoutPricingConfig } from '../transaction-reference/payment-pricing.util';
import { TransactionReferenceService } from '../transaction-reference/transaction-reference.service';
import { CreateTransactionReferenceDto } from '../transaction-reference/dto/create-transaction-reference.dto';
import { InitiateDonationDto } from '../transaction-reference/dto/initiate-donation.dto';
import { PaymentProviderDto } from '../transaction-reference/dto/payment-provider.dto';
import { VolunteerService } from '../volunteer/volunteer.service';
import { occupiedVolunteerStatuses } from '../volunteer/volunteer.util';
import { WebVolunteerDto } from './public-web.dto';
import type { WebSessionContext } from './web-session.guard';
import * as QRCode from 'qrcode';

const withPassImages = <T extends { qrCode: string }>(passes: T[]) =>
  Promise.all(
    passes.map(async (pass) => ({
      ...pass,
      qrImage: await QRCode.toDataURL(pass.qrCode, { width: 320, margin: 2 }),
    })),
  );

export const publicEventSelect = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  thumbnailUrl: true,
  startDate: true,
  endDate: true,
  isPhysicalEvent: true,
  location: true,
  impactTitle: true,
  impactDescription: true,
  impactSdgGoals: true,
  impactPaths: true,
  tags: true,
  links: true,
  registrationType: true,
  registrationFee: true,
  registrationAttendees: true,
  donationsEnabled: true,
  donationTarget: true,
  foodBankCollectionStatus: true,
  foodBankTimeZone: true,
  creator: {
    select: { id: true, username: true, fullName: true, profilePicUrlTN: true },
  },
  eventTickets: {
    where: { isVisible: true },
    select: {
      id: true,
      type: true,
      description: true,
      price: true,
      updatedPrice: true,
      quantity: true,
      sold: true,
      perks: true,
    },
  },
  volunteerRoles: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      capacity: true,
      requiresApproval: true,
      isOpen: true,
      _count: {
        select: {
          applications: {
            where: { status: { in: occupiedVolunteerStatuses } },
          },
        },
      },
    },
  },
} satisfies Prisma.EventSelect;

@Injectable()
export class PublicWebService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionReferenceService,
    private readonly volunteers: VolunteerService,
  ) {}

  config() {
    return {
      playStoreUrl: process.env.PUBLIC_PLAY_STORE_URL || null,
      appStoreUrl: process.env.PUBLIC_APP_STORE_URL || null,
      testingUrl: 'https://uat.gathergo.events',
    };
  }

  async event(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: publicEventSelect,
    });
    if (!event) throw new NotFoundException('Event not found.');
    return {
      ...event,
      collectionAvailability:
        event.registrationType === 'foodbank'
          ? collectionAvailability(event, new Date())
          : null,
      maxTicketsPerCheckout: Number(process.env.CHECKOUT_MAX_TICKETS || 4),
      pricingConfig: getCheckoutPricingConfig({
        availableProviders: [PaymentProvider.PAYSTACK],
      }),
    };
  }

  async carpool(id: string) {
    const ride = await this.prisma.carpool.findFirst({
      where: { id, isDeleted: false },
      select: {
        id: true,
        origin: true,
        destination: true,
        departureTime: true,
        availableSeats: true,
        event: { select: { id: true, title: true, startDate: true } },
      },
    });
    if (!ride) throw new NotFoundException('Carpool not found.');
    return ride;
  }

  tickets(
    session: WebSessionContext,
    dto: CreateTransactionReferenceDto,
    key: string,
  ) {
    return this.transactions.initiate(
      session.userId,
      session.user.email,
      {
        ...dto,
        provider: PaymentProviderDto.PAYSTACK,
        clientContext: { platform: 'web' },
      },
      key,
      { channel: 'WEB' },
    );
  }

  registration(session: WebSessionContext, eventId: string, key: string) {
    return this.transactions.initiateRegistration(
      session.userId,
      session.user.email,
      eventId,
      key,
      {
        provider: PaymentProviderDto.PAYSTACK,
        channel: 'WEB',
        clientContext: { platform: 'web' },
      },
    );
  }

  donation(session: WebSessionContext, dto: InitiateDonationDto, key: string) {
    return this.transactions.initiateDonation(
      session.userId,
      session.user.email,
      {
        ...dto,
        provider: PaymentProviderDto.PAYSTACK,
        clientContext: { platform: 'web' },
      },
      { channel: 'WEB', idempotencyKey: key },
    );
  }

  async volunteer(
    session: WebSessionContext,
    eventId: string,
    roleId: string,
    dto: WebVolunteerDto,
  ) {
    await this.prisma.user.updateMany({
      where: { id: session.userId, fullName: null },
      data: { fullName: dto.fullName },
    });
    return this.volunteers.apply(eventId, roleId, session.userId, {
      note: dto.note,
    });
  }

  async receipt(session: WebSessionContext, id: string) {
    const transaction = await this.transactions.getTransactionStatus(
      id,
      session.userId,
    );
    const event = transaction.event
      ? await this.prisma.event.findUniqueOrThrow({
          where: { id: transaction.event.id },
          select: { id: true, title: true, registrationType: true },
        })
      : null;
    const confirmed = transaction.status === 'SUCCESS';
    const [tickets, registrations] = confirmed
      ? await Promise.all([
          this.prisma.ticket.findMany({
            where: { transactionId: id, userId: session.userId },
            select: {
              id: true,
              qrCode: true,
              isUsed: true,
              eventTicket: { select: { type: true } },
            },
          }),
          this.prisma.registration.findMany({
            where: { transactionId: id, userId: session.userId },
            select: { id: true, qrCode: true, isUsed: true },
          }),
        ])
      : [[], []];
    return {
      id: transaction.id,
      status: transaction.status,
      paymentType: transaction.paymentType,
      amount: transaction.amount,
      baseAmount: transaction.baseAmount,
      createdAt: transaction.createdAt,
      event,
      fulfilledAt: transaction.fulfilledAt,
      paymentUrl: transaction.paymentUrl,
      paymentAccessCode: transaction.paymentAccessCode,
      tickets: await withPassImages(tickets),
      registrations: await withPassImages(registrations),
    };
  }

  cancel(session: WebSessionContext, id: string) {
    return this.transactions.cancelCheckout(id, session.userId);
  }
}

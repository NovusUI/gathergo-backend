import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CheckoutInitializationStatus,
  PaymentProvider,
  PaymentType,
  Prisma,
  ReservationStatus,
  RiskStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from 'src/prisma/prisma.service';
import { TicketService } from '../ticket/ticket.service';
import { RegistrationService } from '../registration/registration.service';
import { PaystackInitializedTransaction } from '../paystack/types/paystack-response.type';
import {
  databaseNow,
  lockCheckoutEvent,
  reservedTicketQuantity,
  registrationOccupancy,
} from './checkout-inventory';
import {
  checkoutInclude,
  checkoutTicketItems,
  CheckoutMetadata,
  CheckoutRecord,
  CollectedCheckoutInput,
  CreateCheckoutInput,
} from './checkout.types';

export class CapacityUnavailableException extends ConflictException {}

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tickets: TicketService,
    private readonly registrations: RegistrationService,
  ) {}

  get holdSeconds() {
    return this.config.get<number>('CHECKOUT_HOLD_SECONDS', 300);
  }
  get maxTickets() {
    return this.config.get<number>('CHECKOUT_MAX_TICKETS', 4);
  }
  hashRequest(input: object) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  validateKey(key: string) {
    if (!isUUID(key, '4'))
      throw new BadRequestException(
        'A valid Idempotency-Key header is required for checkout.',
      );
  }

  metadata(record: Pick<CheckoutRecord, 'metadata'>): CheckoutMetadata {
    // Checkout metadata is the application-owned payment snapshot, not client JSON.
    return record.metadata as CheckoutMetadata;
  }

  validateQuantity(items: ReadonlyArray<{ quantity: number }>) {
    if (
      items.length === 0 ||
      items.some(
        (item) => !Number.isSafeInteger(item.quantity) || item.quantity < 1,
      ) ||
      items.reduce((sum, item) => sum + item.quantity, 0) > this.maxTickets
    )
      throw new BadRequestException(
        `Choose between 1 and ${this.maxTickets} tickets per checkout.`,
      );
  }

  async findReplay(userId: string, key: string, hash: string) {
    this.validateKey(key);
    const record = await this.prisma.transactionReference.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      include: checkoutInclude,
    });
    if (record && record.requestHash !== hash)
      throw new ConflictException(
        'This checkout key was already used for a different order.',
      );
    return record;
  }

  async create(input: CreateCheckoutInput): Promise<CheckoutRecord> {
    this.validateKey(input.idempotencyKey);
    const items = checkoutTicketItems(input.metadata);
    if (input.paymentType === PaymentType.TICKET) this.validateQuantity(items);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId + ':' + input.idempotencyKey}, 0))::text`;
        const replay = await tx.transactionReference.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: input.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          include: checkoutInclude,
        });
        if (replay) {
          if (replay.requestHash !== input.requestHash)
            throw new ConflictException(
              'This checkout key was already used for a different order.',
            );
          return replay;
        }
        await lockCheckoutEvent(tx, input.eventId);
        const now = await databaseNow(tx);
        const active = await tx.transactionReference.findFirst({
          where: {
            userId: input.userId,
            eventId: input.eventId,
            reservation: {
              status: ReservationStatus.HELD,
              expiresAt: { gt: now },
            },
          },
        });
        if (active)
          throw new ConflictException({
            message:
              'You already have an active checkout for this event. Resume it or cancel it before starting another.',
            transactionId: active.id,
          });
        const record = await tx.transactionReference.create({
          data: {
            ...input.data,
            userId: input.userId,
            eventId: input.eventId,
            paymentType: input.paymentType,
            paymentProvider: input.provider,
            metadata: input.metadata as Prisma.InputJsonObject,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
          },
          include: checkoutInclude,
        });
        const plan = await this.assertCapacity(tx, record, now, true);
        const paid = record.amount > 0;
        await tx.checkoutReservation.create({
          data: {
            transactionId: record.id,
            status: ReservationStatus.HELD,
            expiresAt: new Date(
              now.getTime() + (paid ? this.holdSeconds * 1000 : 0),
            ),
            items: {
              create: plan.map((item) => ({
                eventTicketId: item.eventTicketId,
                quantity: item.quantityToIssue,
              })),
            },
          },
        });
        if (!paid) {
          await this.issue(tx, record, plan, now);
          await tx.transactionReference.update({
            where: { id: record.id },
            data: {
              status: TransactionStatusType.SUCCESS,
              fulfilledAt: now,
              initializationStatus: CheckoutInitializationStatus.READY,
            },
          });
        }
        return tx.transactionReference.findUniqueOrThrow({
          where: { id: record.id },
          include: checkoutInclude,
        });
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }

  private async assertCapacity(
    tx: Prisma.TransactionClient,
    record: CheckoutRecord,
    now: Date,
    checkPrice: boolean,
  ) {
    const event = await tx.event.findUniqueOrThrow({
      where: { id: record.eventId! },
    });
    if (event.endDate <= now)
      throw new CapacityUnavailableException('This event has ended.');
    const metadata = this.metadata(record);
    if (record.paymentType === PaymentType.REGISTRATION) {
      if (event.registrationType !== 'registration')
        throw new BadRequestException(
          'This event does not accept registrations.',
        );
      const sponsored = metadata.sponsorship?.beneficiaryType === 'SPONSORED';
      const existing = await tx.registration.findFirst({
        where: { transactionId: record.id },
      });
      if (existing) return [];
      if (!sponsored) {
        const duplicate = await tx.registration.findFirst({
          where: { eventId: event.id, userId: record.userId, status: 'active' },
        });
        if (duplicate)
          throw new CapacityUnavailableException(
            'You are already registered for this event.',
          );
      }
      if (
        event.registrationAttendees !== null &&
        (await registrationOccupancy(tx, event.id, now, record.id)) >=
          event.registrationAttendees
      )
        throw new CapacityUnavailableException(
          'No registration spaces are currently available.',
        );
      if (
        checkPrice &&
        (event.registrationFee ?? 0) * 100 !== metadata.pricing.grossAmountKobo
      )
        throw new ConflictException(
          'The registration price changed. Please review checkout again.',
        );
      return [];
    }
    if (event.registrationType !== 'ticket')
      throw new BadRequestException('This event does not sell tickets.');
    const items = checkoutTicketItems(metadata);
    const plan = await this.tickets.planIssuance(tx, record.id, items);
    for (const item of plan) {
      const ticket = await tx.eventTicket.findUnique({
        where: { id: item.eventTicketId },
      });
      if (!ticket || ticket.eventId !== event.id)
        throw new BadRequestException(
          'A ticket does not belong to this event.',
        );
      if (checkPrice && !ticket.isVisible)
        throw new CapacityUnavailableException(
          'This ticket is not currently on sale.',
        );
      const held = await reservedTicketQuantity(tx, ticket.id, now, record.id);
      if (ticket.quantity - ticket.sold - held < item.quantityToIssue)
        throw new CapacityUnavailableException(
          `${ticket.type} has insufficient tickets available.`,
        );
      if (checkPrice) {
        const paidItem = metadata.paidTickets?.find(
          (value) => value.eventTicketId === item.eventTicketId,
        );
        const expected = paidItem
          ? paidItem.totalPriceKobo / paidItem.quantity
          : 0;
        if (
          Math.round((ticket.updatedPrice ?? ticket.price) * 100) !== expected
        )
          throw new ConflictException(
            'A ticket price changed. Please review checkout again.',
          );
      }
    }
    return plan;
  }

  private async issue(
    tx: Prisma.TransactionClient,
    record: CheckoutRecord,
    plan: Awaited<ReturnType<TicketService['planIssuance']>>,
    now: Date,
  ) {
    if (record.paymentType === PaymentType.TICKET) {
      await this.tickets.issue(tx, record, plan);
      for (const item of plan) {
        if (item.quantityToIssue > 0)
          await tx.eventTicket.update({
            where: { id: item.eventTicketId },
            data: { sold: { increment: item.quantityToIssue } },
          });
      }
    } else if (
      this.metadata(record).sponsorship?.beneficiaryType !== 'SPONSORED'
    ) {
      await this.registrations.issue(
        tx,
        record.eventId!,
        record.userId,
        record.id,
      );
    }
    await tx.checkoutReservation.upsert({
      where: { transactionId: record.id },
      create: {
        transactionId: record.id,
        status: ReservationStatus.CONFIRMED,
        expiresAt: now,
      },
      update: { status: ReservationStatus.CONFIRMED },
    });
    await tx.checkoutFulfillmentJob.create({
      data: { transactionId: record.id },
    });
  }

  async complete(input: CollectedCheckoutInput) {
    const snapshot = await this.prisma.transactionReference.findUnique({
      where: { id: input.transactionId },
      include: checkoutInclude,
    });
    if (!snapshot || !snapshot.eventId)
      throw new NotFoundException('Checkout not found');
    return this.prisma.$transaction(
      async (tx) => {
        await lockCheckoutEvent(tx, snapshot.eventId!);
        await tx.$queryRaw`SELECT "id" FROM "TransactionReference" WHERE "id" = ${input.transactionId} FOR UPDATE`;
        const record = await tx.transactionReference.findUniqueOrThrow({
          where: { id: input.transactionId },
          include: checkoutInclude,
        });
        if (
          [
            TransactionStatusType.SUCCESS,
            TransactionStatusType.REFUND_REQUIRED,
            TransactionStatusType.REFUNDED,
          ].some((status) => status === record.status)
        )
          return record;
        const now = await databaseNow(tx);
        let refundReason: string | null = null;
        if (record.amount !== input.amountKobo)
          refundReason = 'The collected amount does not match the checkout.';
        if (record.reservation?.status === ReservationStatus.CANCELLED)
          refundReason =
            'The checkout was cancelled before payment was confirmed.';
        let plan: Awaited<ReturnType<TicketService['planIssuance']>> = [];
        if (!refundReason) {
          try {
            plan = await this.assertCapacity(tx, record, now, false);
          } catch (error) {
            if (!(error instanceof CapacityUnavailableException)) throw error;
            refundReason = error.message;
          }
        }
        if (refundReason) {
          await tx.checkoutReservation.updateMany({
            where: { transactionId: record.id, status: ReservationStatus.HELD },
            data: { status: ReservationStatus.EXPIRED },
          });
          await tx.checkoutRefund.create({
            data: {
              transactionId: record.id,
              amountKobo: input.amountKobo,
              reason: refundReason,
              providerTransactionId: input.providerTransactionId,
            },
          });
          return tx.transactionReference.update({
            where: { id: record.id },
            data: {
              status: TransactionStatusType.REFUND_REQUIRED,
              amount: input.amountKobo,
              creatorPayable: 0,
              platformFee: 0,
              providerFee: input.providerFeeKobo,
              settlementStatus: SettlementStatus.FAILED,
              providerReference: input.providerReference,
              providerPayload: input.providerPayload,
            },
            include: checkoutInclude,
          });
        }
        await this.issue(tx, record, plan, now);
        const metadata = this.metadata(record);
        return tx.transactionReference.update({
          where: { id: record.id },
          data: {
            status: TransactionStatusType.SUCCESS,
            fulfilledAt: now,
            amount: input.amountKobo,
            providerReference: input.providerReference,
            providerPayload: input.providerPayload,
            platformFee: input.pricing.platformFeeKobo,
            providerFee: input.pricing.providerFeeKobo,
            creatorPayable: input.pricing.creatorPayableKobo,
            settlementStatus:
              record.riskStatus === RiskStatus.CLEAR
                ? input.settlementStatus
                : SettlementStatus.HELD_RISK,
            metadata: {
              ...metadata,
              pricing: input.pricing,
              ...(metadata.sponsorship
                ? {
                    sponsorship: {
                      ...metadata.sponsorship,
                      status: 'PENDING_ASSIGNMENT',
                    },
                  }
                : {}),
            } as Prisma.InputJsonObject,
          },
          include: checkoutInclude,
        });
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }

  async claimInitialization(id: string) {
    const result = await this.prisma.transactionReference.updateMany({
      where: {
        id,
        initializationStatus: CheckoutInitializationStatus.NOT_STARTED,
        status: {
          in: [
            TransactionStatusType.PENDING,
            TransactionStatusType.AWAITING_TRANSFER,
          ],
        },
      },
      data: {
        initializationStatus: CheckoutInitializationStatus.INITIALIZING,
        initializationStartedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async finishInitialization(
    id: string,
    input: {
      paymentUrl: string | null;
      providerReference?: string | null;
      providerPayload?: Prisma.InputJsonValue;
      instructions?: Prisma.JsonObject | null;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TransactionReference" WHERE "id" = ${id} FOR UPDATE`;
      const record = await tx.transactionReference.findUniqueOrThrow({
        where: { id },
      });
      await tx.transactionReference.update({
        where: { id },
        data: {
          paymentUrl: input.paymentUrl,
          initializationStatus: CheckoutInitializationStatus.READY,
          providerReference: input.providerReference,
          providerPayload: input.providerPayload,
          metadata: {
            ...this.metadata(record),
            providerInstructions: input.instructions ?? null,
          } as Prisma.InputJsonObject,
        },
      });
      return tx.transactionReference.findUniqueOrThrow({
        where: { id },
        include: checkoutInclude,
      });
    });
  }

  async initializationFailed(id: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "TransactionReference" WHERE "id" = ${id} FOR UPDATE`;
      await tx.transactionReference.updateMany({
        where: {
          id,
          status: {
            in: [
              TransactionStatusType.PENDING,
              TransactionStatusType.AWAITING_TRANSFER,
            ],
          },
        },
        data: {
          status: TransactionStatusType.EXPIRED,
          initializationStatus: CheckoutInitializationStatus.FAILED,
        },
      });
      await tx.checkoutReservation.updateMany({
        where: { transactionId: id, status: ReservationStatus.HELD },
        data: { status: ReservationStatus.EXPIRED },
      });
    });
  }

  async cancel(id: string, userId: string) {
    const snapshot = await this.prisma.transactionReference.findFirst({
      where: { id, userId },
      include: checkoutInclude,
    });
    if (!snapshot || !snapshot.eventId || !snapshot.reservation)
      throw new NotFoundException('Checkout not found');
    return this.prisma.$transaction(async (tx) => {
      await lockCheckoutEvent(tx, snapshot.eventId!);
      await tx.$queryRaw`SELECT "id" FROM "TransactionReference" WHERE "id" = ${id} FOR UPDATE`;
      const record = await tx.transactionReference.findUniqueOrThrow({
        where: { id },
        include: checkoutInclude,
      });
      if (record.fulfilledAt || record.refund)
        throw new ConflictException('This payment has already been processed.');
      await tx.checkoutReservation.update({
        where: { transactionId: id },
        data: { status: ReservationStatus.CANCELLED },
      });
      return tx.transactionReference.update({
        where: { id },
        data: { status: TransactionStatusType.EXPIRED },
        include: checkoutInclude,
      });
    });
  }

  async expireHolds() {
    return this.prisma.$transaction(async (tx) => {
      const now = await databaseNow(tx);
      await tx.transactionReference.updateMany({
        where: {
          status: {
            in: [
              TransactionStatusType.PENDING,
              TransactionStatusType.AWAITING_TRANSFER,
            ],
          },
          reservation: {
            status: ReservationStatus.HELD,
            expiresAt: { lte: now },
          },
        },
        data: { status: TransactionStatusType.EXPIRED },
      });
      return tx.checkoutReservation.updateMany({
        where: { status: ReservationStatus.HELD, expiresAt: { lte: now } },
        data: { status: ReservationStatus.EXPIRED },
      });
    });
  }

  async get(id: string) {
    return this.prisma.transactionReference.findUniqueOrThrow({
      where: { id },
      include: checkoutInclude,
    });
  }

  format(record: CheckoutRecord) {
    const metadata = this.metadata(record);
    const expired =
      record.reservation?.status === ReservationStatus.HELD &&
      record.reservation.expiresAt.getTime() <= Date.now();
    const status = expired ? TransactionStatusType.EXPIRED : record.status;
    const payable =
      !expired &&
      [
        TransactionStatusType.PENDING,
        TransactionStatusType.AWAITING_TRANSFER,
      ].some((value) => value === status);
    return {
      message:
        status === TransactionStatusType.SUCCESS
          ? 'Your passes are ready.'
          : status === TransactionStatusType.EXPIRED
            ? 'This checkout has expired. Start a new checkout to try again.'
            : status === TransactionStatusType.REFUND_REQUIRED
              ? 'Your payment could not be fulfilled and needs a refund.'
              : 'Checkout ready',
      transactionId: record.id,
      paymentProvider: record.paymentProvider,
      paymentUrl: payable ? record.paymentUrl : null,
      // A ready, pending Paystack checkout stores the initialize response here.
      paymentAccessCode:
        payable &&
        record.paymentProvider === PaymentProvider.PAYSTACK &&
        record.initializationStatus === CheckoutInitializationStatus.READY
          ? (record.providerPayload as PaystackInitializedTransaction)
              .access_code
          : null,
      paymentInstructions: payable
        ? (metadata.providerInstructions ?? null)
        : null,
      unavailableTickets: [],
      freeTickets:
        record.status === TransactionStatusType.SUCCESS
          ? (metadata.freeTickets ?? [])
          : [],
      totalAmount: record.amount / 100,
      totalAmountKobo: record.amount,
      pricing: metadata.pricing,
      riskStatus: record.riskStatus,
      settlementStatus: record.settlementStatus,
      checkoutStatus: status,
      initializationStatus: record.initializationStatus,
      reservationStatus: expired
        ? ReservationStatus.EXPIRED
        : (record.reservation?.status ?? null),
      reservationExpiresAt:
        record.reservation?.status === ReservationStatus.HELD
          ? record.reservation.expiresAt.toISOString()
          : null,
      serverTime: new Date().toISOString(),
      maxTicketsPerCheckout: this.maxTickets,
    };
  }
}

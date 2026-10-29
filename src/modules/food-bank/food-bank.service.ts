import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Event } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { databaseNow, lockCheckoutEvent } from '../checkout/checkout-inventory';
import { nextCollectionWindow } from './collection-windows';
import {
  collectionAvailability,
  collectionLocalDay,
  mealCollectionDetails,
  MEAL_COLLECTION_MESSAGES,
} from './collection-policy';
import {
  UpdateCollectionDto,
  RescheduleCollectionDto,
} from './dto/collection.dto';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class FoodBankService {
  private readonly logger = new Logger(FoodBankService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async event(tx: Prisma.TransactionClient, eventId: string) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event || event.registrationType !== 'foodbank')
      throw new NotFoundException('Food bank not found');
    return event;
  }

  private async allocate(
    tx: Prisma.TransactionClient,
    userId: string,
    eventId: string,
  ) {
    // All claims, including donation fulfillment, take the same event lock.
    await lockCheckoutEvent(tx, eventId);
    const event = await this.event(tx, eventId);
    const existing = await tx.mealPass.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (existing) return { ...existing, timeZone: event.foodBankTimeZone };
    const now = await databaseNow(tx);
    if (now >= event.endDate || event.foodBankCollectionStatus === 'CLOSED')
      return null;
    const { foodBankTotalMeals, foodBankSlotCapacity, foodBankSlotMinutes } =
      event;
    if (
      foodBankTotalMeals === null ||
      foodBankSlotCapacity === null ||
      foodBankSlotMinutes === null
    )
      throw new BadRequestException(
        'Food bank collection settings are missing',
      );
    const slots = await tx.mealPass.groupBy({
      by: ['collectionStart'],
      where: { eventId },
      _count: { _all: true },
    });
    const window = nextCollectionWindow(
      {
        ...event,
        foodBankTotalMeals,
        foodBankSlotCapacity,
        foodBankSlotMinutes,
      },
      slots.map((slot) => ({
        collectionStart: slot.collectionStart,
        count: slot._count._all,
      })),
      now,
    );
    if (!window) return null;
    const pass = await tx.mealPass.create({
      data: {
        eventId,
        userId,
        qrCode: `ggmeal:${randomUUID()}`,
        collectionStart: window.start,
        collectionEnd: window.end,
      },
    });
    return { ...pass, timeZone: event.foodBankTimeZone };
  }

  async claim(userId: string, eventId: string) {
    const pass = await this.prisma.$transaction(
      (tx) => this.allocate(tx, userId, eventId),
      { maxWait: 10000, timeout: 15000 },
    );
    if (!pass)
      throw new ConflictException(
        'No collection windows are available. Please check with the organiser.',
      );
    return this.present(pass, pass.timeZone);
  }

  async grantForDonation(
    tx: Prisma.TransactionClient,
    userId: string,
    eventId: string,
  ) {
    // A donation still settles when the bank is full or collection has ended.
    return this.allocate(tx, userId, eventId);
  }

  async mine(userId: string, eventId: string) {
    const event = await this.event(this.prisma, eventId);
    const pass = await this.prisma.mealPass.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    return pass ? this.present(pass, event.foodBankTimeZone) : null;
  }

  async myPasses(userId: string) {
    const passes = await this.prisma.mealPass.findMany({
      where: { userId },
      orderBy: { collectionStart: 'desc' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            startDate: true,
            endDate: true,
            location: true,
            registrationType: true,
            isPhysicalEvent: true,
            foodBankTimeZone: true,
          },
        },
      },
    });
    return passes.map(({ event, ...pass }) => ({
      ...this.present(pass, event.foodBankTimeZone),
      event,
    }));
  }

  async findForScan(qrCode: string) {
    const pass = await this.prisma.mealPass.findUnique({
      where: { qrCode },
      include: { event: true },
    });
    if (!pass) throw new NotFoundException('Meal pass not found');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: pass.userId },
      select: { username: true, fullName: true },
    });
    return { pass, userName: user.fullName || user.username || 'Guest' };
  }

  async collection(userId: string, eventId: string) {
    const event = await this.event(this.prisma, eventId);
    return this.presentCollection(
      event,
      userId,
      await databaseNow(this.prisma),
    );
  }

  async updateCollection(
    userId: string,
    eventId: string,
    dto: UpdateCollectionDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockCheckoutEvent(tx, eventId);
      const event = await this.event(tx, eventId);
      this.assertManage(event, userId, dto.expectedUpdatedAt);
      const now = await databaseNow(tx);
      const availability = collectionAvailability(event, now);
      if (
        dto.status === 'OPEN' &&
        (availability === 'upcoming' || availability === 'ended')
      )
        throw new BadRequestException(
          'Collection can only open on its scheduled collection day. Reschedule it to change the day.',
        );
      if (dto.status === 'PAUSED' && event.foodBankCollectionStatus !== 'OPEN')
        throw new ConflictException('Only an open collection can be paused.');
      const updated = await tx.event.update({
        where: { id: eventId },
        data: { foodBankCollectionStatus: dto.status },
      });
      return this.presentCollection(updated, userId, now);
    });
  }

  async reschedule(
    userId: string,
    eventId: string,
    dto: RescheduleCollectionDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockCheckoutEvent(tx, eventId);
      const event = await this.event(tx, eventId);
      this.assertManage(event, userId, dto.expectedUpdatedAt);
      if (event.foodBankCollectionStatus === 'OPEN')
        throw new ConflictException(
          'Pause or close collection before rescheduling.',
        );
      const now = await databaseNow(tx);
      const startDate = new Date(dto.startDate);
      if (
        collectionLocalDay(startDate, event.foodBankTimeZone) <
        collectionLocalDay(now, event.foodBankTimeZone)
      )
        throw new BadRequestException(
          'Choose today or a future collection day.',
        );
      const shift = startDate.getTime() - event.startDate.getTime();
      if (shift === 0) return { event, now, recipients: [] };
      const endDate = new Date(event.endDate.getTime() + shift);
      const recipients = await tx.mealPass.findMany({
        where: { eventId, isUsed: false },
        select: { userId: true },
      });
      const updated = await tx.event.update({
        where: { id: eventId },
        data: { startDate, endDate, foodBankCollectionStatus: 'NOT_STARTED' },
      });
      // Shift unused passes together; collected passes retain their original audit trail.
      await tx.$executeRaw`UPDATE "MealPass"
        SET "collectionStart" = "collectionStart" + ${shift}::double precision * interval '1 millisecond',
            "collectionEnd" = "collectionEnd" + ${shift}::double precision * interval '1 millisecond'
        WHERE "eventId" = ${eventId} AND "isUsed" = false`;
      return { event: updated, now, recipients };
    });
    let notificationFailed = false;
    if (result.recipients.length > 0) {
      try {
        await this.notifications.createNotification({
          recipientIds: result.recipients.map((pass) => pass.userId),
          type: 'food_bank_rescheduled',
          title: 'Food bank collection rescheduled',
          message: `${result.event.title} has moved to ${result.event.startDate.toLocaleString(
            'en-NG',
            {
              timeZone: result.event.foodBankTimeZone,
              dateStyle: 'medium',
              timeStyle: 'short',
            },
          )} (${result.event.foodBankTimeZone}). Your existing pass is still yours; check it for your updated suggested arrival time.`,
          link: `/food-bank/${eventId}`,
          data: { eventId },
        });
      } catch (error) {
        notificationFailed = true;
        this.logger.error(
          'Collection was rescheduled, but holder notifications failed',
          error,
        );
      }
    }
    return {
      ...this.presentCollection(result.event, userId, result.now),
      notificationFailed,
    };
  }

  async redeem(id: string, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reference = await tx.mealPass.findUniqueOrThrow({
        where: { id },
        select: { eventId: true },
      });
      await lockCheckoutEvent(tx, reference.eventId);
      const pass = await tx.mealPass.findUniqueOrThrow({
        where: { id },
        include: { event: true },
      });
      const now = await databaseNow(tx);
      const details = mealCollectionDetails(pass, now);
      if (details.status !== 'ready')
        throw new ConflictException(MEAL_COLLECTION_MESSAGES[details.status]);
      const result = await tx.mealPass.updateMany({
        where: { id, isUsed: false },
        data: { isUsed: true, collectedAt: now, collectedBy: staffId },
      });
      if (result.count !== 1)
        throw new ConflictException('This meal has already been collected.');
      return { ...pass, isUsed: true };
    });
  }

  private assertManage(
    event: Event,
    userId: string,
    expectedUpdatedAt: string,
  ) {
    if (event.creatorId !== userId)
      throw new ForbiddenException('Only the organiser can manage collection.');
    if (event.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime())
      throw new ConflictException(
        'Collection changed. Refresh before trying again.',
      );
  }

  private presentCollection(event: Event, userId: string, now: Date) {
    const availability = collectionAvailability(event, now);
    return {
      status: event.foodBankCollectionStatus,
      availability,
      timeZone: event.foodBankTimeZone,
      startDate: event.startDate,
      endDate: event.endDate,
      updatedAt: event.updatedAt,
      canManage: event.creatorId === userId,
      canOpen: availability !== 'upcoming' && availability !== 'ended',
      canReserve:
        now < event.endDate && event.foodBankCollectionStatus !== 'CLOSED',
    };
  }

  private present(
    pass: {
      createdAt: Date;
      id: string;
      eventId: string;
      qrCode: string;
      collectionStart: Date;
      collectionEnd: Date;
      isUsed: boolean;
    },
    timeZone: string,
  ) {
    return {
      timeZone,
      createdAt: pass.createdAt,
      id: pass.id,
      eventId: pass.eventId,
      qrCode: pass.qrCode,
      collectionStart: pass.collectionStart,
      collectionEnd: pass.collectionEnd,
      isUsed: pass.isUsed,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SaveEventFeedbackDto } from './event-feedback.dto';
import { interestWeightChanges } from './interest-profile';
import { UserPreferenceService } from './user-preference.service';

@Injectable()
export class EventFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: UserPreferenceService,
  ) {}

  private eligibleEvents(
    userId: string,
    learningSince: Date,
    now: Date,
  ): Prisma.EventWhereInput {
    const scan = {
      userId,
      isUsed: true,
      status: 'used',
      scannedAt: { not: null, lte: now },
    };
    return {
      endDate: {
        lte: now,
        gt: new Date(
          Math.max(learningSince.getTime(), now.getTime() - 30 * 86400000),
        ),
      },
      OR: [
        { Registration: { some: scan } },
        { eventTickets: { some: { tickets: { some: scan } } } },
        {
          volunteers: {
            some: {
              userId,
              status: { in: ['CHECKED_IN', 'COMPLETED'] },
              checkedInAt: { not: null, lte: now },
            },
          },
        },
      ],
    };
  }

  async pending(userId: string) {
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { id: true, learningSince: true },
    });
    if (!preference) return null;
    const now = new Date();
    return this.prisma.event.findFirst({
      where: {
        ...this.eligibleEvents(userId, preference.learningSince, now),
        feedback: {
          none: {
            preferenceId: preference.id,
            OR: [
              { respondedAt: { not: null } },
              { deferredUntil: { gt: now } },
            ],
          },
        },
      },
      select: { id: true, title: true, endDate: true },
      orderBy: [{ endDate: 'desc' }, { id: 'asc' }],
    });
  }

  private async context(
    tx: Prisma.TransactionClient,
    userId: string,
    eventId: string,
  ) {
    // Serialize answers for one map so retries cannot add the same signal twice.
    const rows = await tx.$queryRaw<
      { id: string; learningSince: Date }[]
    >`SELECT "id", "learningSince" FROM "UserPreference" WHERE "userId" = ${userId} FOR UPDATE`;
    const preference = rows[0];
    if (!preference)
      throw new BadRequestException(
        'Set up your interest map before answering an event survey.',
      );
    const event = await tx.event.findFirst({
      where: {
        id: eventId,
        ...this.eligibleEvents(userId, preference.learningSince, new Date()),
      },
      select: { id: true },
    });
    if (!event)
      throw new NotFoundException(
        'This survey is only available after an event you checked in to.',
      );
    return preference;
  }

  save(userId: string, eventId: string, dto: SaveEventFeedbackDto) {
    if (dto.rating === 'NOT_FOR_ME' && dto.moreLikeThis)
      throw new BadRequestException(
        'Choose a positive or neutral answer to ask for more events like this.',
      );
    return this.prisma.$transaction(async (tx) => {
      const preference = await this.context(tx, userId, eventId);
      const before = await this.preferences.rankingProfile(userId, tx);
      const existing = await tx.eventFeedback.findUnique({
        where: {
          preferenceId_eventId: { preferenceId: preference.id, eventId },
        },
      });
      const data = {
        rating: dto.rating,
        moreLikeThis: dto.moreLikeThis,
        respondedAt: existing?.respondedAt ?? new Date(),
        deferredUntil: null,
      };
      await tx.eventFeedback.upsert({
        where: {
          preferenceId_eventId: { preferenceId: preference.id, eventId },
        },
        create: { preferenceId: preference.id, eventId, ...data },
        update: data,
      });
      const { profile } = await this.preferences.rankingProfile(userId, tx);
      return {
        profile,
        changes: interestWeightChanges(before.profile.weights, profile.weights),
        rating: dto.rating,
        moreLikeThis: dto.moreLikeThis,
      };
    });
  }

  defer(userId: string, eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const preference = await this.context(tx, userId, eventId);
      const key = { preferenceId: preference.id, eventId };
      const existing = await tx.eventFeedback.findUnique({
        where: { preferenceId_eventId: key },
      });
      if (existing?.respondedAt)
        throw new BadRequestException('You have already answered this survey.');
      const deferredUntil = new Date(Date.now() + 86400000);
      await tx.eventFeedback.upsert({
        where: { preferenceId_eventId: key },
        create: { ...key, deferredUntil },
        update: { deferredUntil },
      });
      return { deferredUntil };
    });
  }
}

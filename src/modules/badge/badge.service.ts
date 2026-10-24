import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BadgeCode, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { BADGE_CATALOG } from './badge.catalog';
import { BadgeActivity, badgeProgress } from './badge-progress';

const monthFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
});

@Injectable()
export class BadgeService {
  constructor(private readonly prisma: PrismaService) {}

  getMine(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      return this.reconcile(tx, userId);
    });
  }

  async getPublic(userId: string) {
    const collection = await this.getMine(userId);
    return collection.badges
      .filter((badge) => badge.status === 'earned' && badge.isPublic)
      .map(({ code, name, category, icon, description, earnedAt }) => ({
        code,
        name,
        category,
        icon,
        description,
        earnedAt,
      }));
  }

  setVisibility(userId: string, code: BadgeCode, isPublic: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUser(tx, userId);
      const collection = await this.reconcile(tx, userId);
      const badge = collection.badges.find((item) => item.code === code);
      if (!badge || badge.status !== 'earned') {
        throw new BadRequestException(
          'Only earned achievements can be displayed on your profile',
        );
      }
      await tx.userBadge.update({
        where: { userId_code: { userId, code } },
        data: { isPublic },
      });
      return {
        ...collection,
        badges: collection.badges.map((item) =>
          item.code === code ? { ...item, isPublic } : item,
        ),
      };
    });
  }

  private async lockUser(tx: Prisma.TransactionClient, userId: string) {
    const users = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (users.length === 0) throw new NotFoundException('User not found');
  }

  private async reconcile(tx: Prisma.TransactionClient, userId: string) {
    const now = new Date();
    const activity = await this.activity(tx, userId, now);
    const saved = new Map(
      (await tx.userBadge.findMany({ where: { userId } })).map((badge) => [
        badge.code,
        badge,
      ]),
    );
    const evaluated = BADGE_CATALOG.map((definition) => {
      const progress = badgeProgress(definition, activity);
      return {
        definition,
        ...progress,
        // Preserve the original award date when a report or other qualifying activity is edited.
        earnedAt:
          progress.earnedAt === null
            ? null
            : (saved.get(definition.code)?.earnedAt ?? progress.earnedAt),
      };
    });
    // Evaluate from source records so refunds, unpublishing and deleted activity cannot leave stale awards.
    await tx.userBadge.updateMany({
      where: {
        userId,
        earnedAt: { not: null },
        code: {
          in: evaluated
            .filter((badge) => badge.earnedAt === null)
            .map((badge) => badge.definition.code),
        },
      },
      data: { earnedAt: null },
    });
    for (const badge of evaluated) {
      if (badge.earnedAt === null) continue;
      const record = await tx.userBadge.upsert({
        where: { userId_code: { userId, code: badge.definition.code } },
        create: {
          userId,
          code: badge.definition.code,
          earnedAt: badge.earnedAt,
          isPublic: badge.definition.category !== 'giving',
        },
        update: { earnedAt: badge.earnedAt },
      });
      saved.set(record.code, record);
    }
    const badges = evaluated.map(({ definition, ...progress }) => ({
      code: definition.code,
      name: definition.name,
      category: definition.category,
      icon: definition.icon,
      description: definition.description,
      requirement: definition.requirement,
      ...progress,
      isPublic: saved.get(definition.code)?.isPublic ?? false,
    }));
    return {
      badges,
      earnedCount: badges.filter((badge) => badge.status === 'earned').length,
      totalCount: badges.length,
    };
  }

  private async activity(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<BadgeActivity> {
    const scanWhere = {
      userId,
      isUsed: true,
      status: 'used',
      scannedAt: { not: null, lte: now },
    };
    const [tickets, registrations, volunteers, hosted, reports, donations] =
      await Promise.all([
        tx.ticket.findMany({
          where: scanWhere,
          select: {
            scannedAt: true,
            eventTicket: { select: { eventId: true } },
          },
        }),
        tx.registration.findMany({
          where: scanWhere,
          select: {
            scannedAt: true,
            eventId: true,
          },
        }),
        tx.eventVolunteer.findMany({
          where: {
            userId,
            status: { in: ['CHECKED_IN', 'COMPLETED'] },
            checkedInAt: { not: null, lte: now },
          },
          select: {
            checkedInAt: true,
            status: true,
            confirmedMinutes: true,
            confirmedById: true,
            completedAt: true,
            event: { select: { id: true, endDate: true } },
          },
        }),
        tx.event.findMany({
          where: { creatorId: userId, endDate: { lte: now } },
          select: {
            endDate: true,
            eventTickets: {
              select: {
                tickets: {
                  where: { ...scanWhere, userId: { not: userId } },
                  select: { scannedAt: true },
                },
              },
            },
            Registration: {
              where: { ...scanWhere, userId: { not: userId } },
              select: { scannedAt: true },
            },
            volunteers: {
              where: {
                userId: { not: userId },
                status: { in: ['CHECKED_IN', 'COMPLETED'] },
                checkedInAt: { not: null, lte: now },
              },
              select: { checkedInAt: true },
            },
          },
        }),
        tx.eventImpactReport.findMany({
          where: {
            creatorId: userId,
            status: 'PUBLISHED',
            publishedAt: { not: null, lte: now },
            event: { creatorId: userId, endDate: { lte: now } },
          },
          select: { publishedAt: true },
        }),
        tx.donation.findMany({
          where: { userId, status: 'completed', amount: { gt: 0 } },
          select: { eventId: true, transactionId: true },
        }),
      ]);
    const transactions = await tx.transactionReference.findMany({
      where: {
        id: { in: donations.map((donation) => donation.transactionId) },
        userId,
        paymentType: 'DONATION',
        status: 'SUCCESS',
        fulfilledAt: { not: null, lte: now },
        refund: { is: null },
      },
      select: { id: true, eventId: true, fulfilledAt: true },
    });
    const attendance = new Map<string, Date>();
    const recordAttendance = (eventId: string, at: Date | null) => {
      if (at === null)
        throw new Error('Checked-in attendance is missing its timestamp');
      const existing = attendance.get(eventId);
      if (!existing || at < existing) attendance.set(eventId, at);
    };
    for (const ticket of tickets)
      recordAttendance(ticket.eventTicket.eventId, ticket.scannedAt);
    for (const registration of registrations)
      recordAttendance(registration.eventId, registration.scannedAt);
    for (const volunteer of volunteers)
      recordAttendance(volunteer.event.id, volunteer.checkedInAt);
    const completed = volunteers.filter(
      (volunteer) =>
        volunteer.status === 'COMPLETED' &&
        volunteer.completedAt !== null &&
        volunteer.completedAt <= now &&
        volunteer.confirmedMinutes !== null &&
        volunteer.confirmedMinutes > 0 &&
        volunteer.confirmedById !== null &&
        volunteer.event.endDate <= now,
    );
    const confirmedWork = completed.map((volunteer) => {
      if (volunteer.completedAt === null || volunteer.confirmedMinutes === null)
        throw new Error('Completed volunteer work is missing its confirmation');
      return { at: volunteer.completedAt, amount: volunteer.confirmedMinutes };
    });
    const gifts = transactions
      .flatMap((transaction) => {
        if (transaction.fulfilledAt === null)
          throw new Error('Fulfilled donation is missing its timestamp');
        const donation = donations.find(
          (item) =>
            item.transactionId === transaction.id &&
            item.eventId === transaction.eventId,
        );
        return donation
          ? [{ eventId: donation.eventId, at: transaction.fulfilledAt }]
          : [];
      })
      .sort((left, right) => left.at.getTime() - right.at.getTime());
    const donatedEvents = new Map<string, Date>();
    const donationMonths = new Map<string, Date>();
    for (const gift of gifts) {
      if (!donatedEvents.has(gift.eventId))
        donatedEvents.set(gift.eventId, gift.at);
      const month = monthFormatter.format(gift.at);
      if (!donationMonths.has(month)) donationMonths.set(month, gift.at);
    }
    const contributions = (dates: Iterable<Date>) =>
      Array.from(dates, (at) => ({ at, amount: 1 }));
    return {
      attendance: contributions(attendance.values()),
      volunteerEvents: confirmedWork.map(({ at }) => ({ at, amount: 1 })),
      volunteerMinutes: confirmedWork,
      hostedEvents: contributions(
        hosted
          .filter((event) =>
            [
              ...event.eventTickets.flatMap((ticket) =>
                ticket.tickets.map((item) => item.scannedAt),
              ),
              ...event.Registration.map((item) => item.scannedAt),
              ...event.volunteers.map((item) => item.checkedInAt),
            ].some((at) => at !== null),
          )
          .map((event) => event.endDate),
      ),
      impactReports: contributions(
        reports.map((report) => {
          if (report.publishedAt === null)
            throw new Error(
              'Published impact report is missing its publication date',
            );
          return report.publishedAt;
        }),
      ),
      donations: contributions(gifts.map((gift) => gift.at)),
      donatedEvents: contributions(donatedEvents.values()),
      donationMonths: contributions(donationMonths.values()),
    };
  }
}

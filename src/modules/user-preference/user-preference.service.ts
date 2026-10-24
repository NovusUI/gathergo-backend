import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  EventInterestSignalDto,
  InterestExamplesDto,
  UpdatePreferenceDto,
} from './dto/update-preference.dto';
import {
  chosenTopics,
  eventTopics,
  interestWeights,
  INTEREST_TOPICS,
  preferenceEventSelect,
  rankPreferenceEvent,
} from './interest-profile';
import type { InterestProfile, ProfileSignal } from './interest-profile';

@Injectable()
export class UserPreferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async updatePreferences(userId: string, dto: UpdatePreferenceDto) {
    await this.prisma.$transaction(async (tx) => {
      const events = await tx.event.findMany({
        where: { id: { in: dto.likedEventIds } },
        select: { id: true },
      });
      if (events.length !== dto.likedEventIds.length)
        throw new BadRequestException(
          'One of these events is no longer available. Refresh your examples.',
        );
      const pref = await tx.userPreference.upsert({
        where: { userId },
        create: {
          userId,
          eventTypes: [],
          interests: dto.interests,
          helpModes: dto.helpModes,
          location: dto.city?.trim() || null,
          learningEnabled: dto.learningEnabled,
        },
        update: {
          interests: dto.interests,
          helpModes: dto.helpModes,
          location: dto.city?.trim() || null,
          learningEnabled: dto.learningEnabled,
        },
      });
      for (const eventId of dto.likedEventIds)
        await tx.interestSignal.upsert({
          where: {
            preferenceId_eventId_kind: {
              preferenceId: pref.id,
              eventId,
              kind: 'LIKE',
            },
          },
          create: { preferenceId: pref.id, eventId, kind: 'LIKE' },
          update: {},
        });
      await tx.user.update({
        where: { id: userId },
        data: { hasPreferences: true },
      });
    });
    return this.getPreferences(userId);
  }

  async getPreferences(userId: string): Promise<InterestProfile> {
    return (await this.rankingProfile(userId)).profile;
  }

  async rankingProfile(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<{ profile: InterestProfile; signals: ProfileSignal[] }> {
    const pref = await db.userPreference.findUnique({
      where: { userId },
      include: {
        eventFeedback: {
          where: { respondedAt: { not: null } },
          orderBy: { respondedAt: 'desc' },
          take: 200,
          include: { event: { select: preferenceEventSelect } },
        },
        signals: {
          where: { createdAt: { gt: new Date(Date.now() - 180 * 86400000) } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include: { event: { select: preferenceEventSelect } },
        },
      },
    });
    if (!pref)
      return {
        profile: {
          interests: [],
          helpModes: [],
          city: null,
          learningEnabled: false,
          weights: [],
        },
        signals: [],
      };
    const answeredEvents = new Set(
      pref.eventFeedback.map((feedback) => feedback.eventId),
    );
    const signals: ProfileSignal[] = pref.signals
      .filter(
        (signal) =>
          !answeredEvents.has(signal.eventId) &&
          (pref.learningEnabled || signal.kind === 'LIKE'),
      )
      .map((signal) => ({
        event: signal.event,
        createdAt: signal.createdAt,
        kind: signal.kind,
      }));
    for (const feedback of pref.eventFeedback) {
      if (feedback.rating === null || feedback.respondedAt === null) continue;
      signals.push({
        event: feedback.event,
        kind: feedback.rating,
        createdAt: feedback.respondedAt,
      });
      if (feedback.moreLikeThis)
        signals.push({
          event: feedback.event,
          kind: 'MORE_LIKE_THIS',
          createdAt: feedback.respondedAt,
        });
    }
    if (pref.learningEnabled) {
      const since = { gt: pref.learningSince };
      const [registrations, tickets, donations, volunteers] = await Promise.all(
        [
          db.registration.findMany({
            where: { userId, status: 'active', createdAt: since },
            select: {
              eventId: true,
              createdAt: true,
              event: { select: preferenceEventSelect },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          db.ticket.findMany({
            where: { userId, status: 'active', createdAt: since },
            select: {
              createdAt: true,
              eventTicket: {
                select: {
                  eventId: true,
                  event: { select: preferenceEventSelect },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          db.donation.findMany({
            where: { userId, status: 'active', createdAt: since },
            select: {
              eventId: true,
              createdAt: true,
              event: { select: preferenceEventSelect },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
          db.eventVolunteer.findMany({
            where: {
              userId,
              status: {
                in: ['APPLIED', 'ACCEPTED', 'CHECKED_IN', 'COMPLETED'],
              },
              createdAt: since,
            },
            select: {
              eventId: true,
              createdAt: true,
              event: { select: preferenceEventSelect },
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
          }),
        ],
      );
      const seen = new Set<string>();
      const add = (eventId: string, signal: ProfileSignal) => {
        const key = `${eventId}:${signal.kind}`;
        if (!answeredEvents.has(eventId) && !seen.has(key)) {
          seen.add(key);
          signals.push(signal);
        }
      };
      for (const item of registrations)
        add(item.eventId, { ...item, kind: 'ATTEND' });
      for (const item of tickets)
        add(item.eventTicket.eventId, {
          event: item.eventTicket.event,
          createdAt: item.createdAt,
          kind: 'ATTEND',
        });
      for (const item of donations)
        add(item.eventId, { ...item, kind: 'DONATE' });
      for (const item of volunteers)
        add(item.eventId, { ...item, kind: 'VOLUNTEER' });
    }
    return {
      profile: {
        interests: chosenTopics(pref.interests),
        helpModes: pref.helpModes,
        city: pref.location,
        learningEnabled: pref.learningEnabled,
        weights: interestWeights(pref.interests, signals),
      },
      signals,
    };
  }

  async recordSignal(userId: string, dto: EventInterestSignalDto) {
    return this.prisma.$transaction(async (tx) => {
      const pref = await tx.userPreference.findUnique({ where: { userId } });
      if (!pref || (!pref.learningEnabled && dto.kind === 'VIEW'))
        return { recorded: false };
      const event = await tx.event.findUnique({
        where: { id: dto.eventId },
        select: { id: true },
      });
      if (!event) throw new NotFoundException('Event not found');
      await tx.interestSignal.upsert({
        where: {
          preferenceId_eventId_kind: {
            preferenceId: pref.id,
            eventId: dto.eventId,
            kind: dto.kind,
          },
        },
        create: { preferenceId: pref.id, eventId: dto.eventId, kind: dto.kind },
        update: {},
      });
      return { recorded: true };
    });
  }

  async resetLearning(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const pref = await tx.userPreference.findUnique({ where: { userId } });
      if (!pref) return;
      await tx.interestSignal.deleteMany({ where: { preferenceId: pref.id } });
      await tx.eventFeedback.deleteMany({ where: { preferenceId: pref.id } });
      await tx.userPreference.update({
        where: { userId },
        data: { learningSince: new Date() },
      });
    });
    return this.getPreferences(userId);
  }

  async deleteMap(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.userPreference.deleteMany({ where: { userId } });
      await tx.userPreference.create({
        data: {
          userId,
          eventTypes: [],
          interests: [],
          helpModes: [],
          learningEnabled: false,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { hasPreferences: true },
      });
    });
    return this.getPreferences(userId);
  }

  async examples(dto: InterestExamplesDto) {
    const interests = dto.interests ? dto.interests.split(',') : [];
    if (
      interests.some((id) => !INTEREST_TOPICS.some((topic) => topic.id === id))
    )
      throw new BadRequestException('Choose a listed interest.');
    const events = await this.prisma.event.findMany({
      where: { endDate: { gt: new Date() } },
      select: { ...preferenceEventSelect, donationsEnabled: true },
      orderBy: { startDate: 'asc' },
      take: 100,
    });
    const profile: InterestProfile = {
      interests,
      helpModes: [],
      city: dto.city?.trim() || null,
      learningEnabled: false,
      weights: interestWeights(interests, []),
    };
    const sorted = events
      .map((event) => ({
        event,
        score: rankPreferenceEvent(event, profile, []).score,
      }))
      .sort((a, b) => b.score - a.score);
    const selected = sorted.slice(0, 3);
    return selected.map(({ event }) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      location: event.location,
      startDate: event.startDate,
      thumbnailUrl: event.thumbnailUrl,
      registrationType: event.registrationType,
      topics: eventTopics(event),
    }));
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CreatorSettlementProfileStatus,
  ImpactReportStatus,
  PaymentProvider,
  Prisma,
  Reoccurring,
} from '@prisma/client';
import { CreateEventDto } from './dto/create-event.dto';
import { normalizeEventLinks } from './event-links.util';
import { UpdateEventDto } from './dto/update-event.dto';
import { CarpoolQueueService } from 'src/queue/carpool/queue.service';
import { MediaService } from '../media/media.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { CreateEventTicketDto } from '../event-ticket/dto/create-event-ticket.dto';
import { getCheckoutPricingConfig } from '../transaction-reference/payment-pricing.util';
import {
  ImpactReportOutcomeDto,
  UpsertEventImpactReportDto,
} from './dto/upsert-event-impact-report.dto';

type ParsedEventTicketDto = CreateEventTicketDto & {
  id?: string;
  isVisible?: boolean;
  updatedPrice?: number | null;
};

type ImpactMapInput = Pick<
  CreateEventDto,
  | 'impactSdgGoals'
  | 'impactPaths'
  | 'impactCommitments'
  | 'impactMapSource'
  | 'impactMapGeneratedAt'
>;

const eventCardInclude = {
  community: true,
  creator: {
    select: {
      id: true,
      username: true,
      profilePicUrlTN: true,
    },
  },
  eventTickets: {
    select: {
      price: true,
    },
  },
} satisfies Prisma.EventInclude;

@Injectable()
export class EventService {
  constructor(
    private prisma: PrismaService,
    private readonly queueService: CarpoolQueueService, // Injected
    private eventTicketService: EventTicketService,
    private mediaService: MediaService,
  ) {}

  private getLowestTicketPrice(event: {
    registrationType?: string | null;
    eventTickets?: Array<{ price: number }> | null;
  }) {
    if (event.registrationType !== 'ticket' || !event.eventTickets?.length) {
      return null;
    }

    const prices = event.eventTickets
      .map((ticket) => Number(ticket.price))
      .filter((price) => Number.isFinite(price) && price >= 0);

    if (!prices.length) {
      return null;
    }

    return Math.min(...prices);
  }

  async create(
    userId: string,
    dto: CreateEventDto,
    file?: Express.Multer.File,
  ) {
    // let imageUrl = dto.imageUrl;
    // let thumbnailUrl: string | null = null;

    // // Upload image BEFORE starting transaction
    // if (!imageUrl && file) {
    //   const { url, thumbnailUrl: thumb } = await this.mediaService.uploadFile(
    //     file,
    //     `events/${userId}`,
    //   );
    //   imageUrl = url;
    //   thumbnailUrl = thumb;
    // }

    const parsedTickets =
      dto.registrationType === 'ticket'
        ? this.parseTicketPayloads(dto.tickets)
        : [];
    const shouldCreateSettlementProfile = this.requiresSettlementProfile({
      registrationType: dto.registrationType,
      registrationFee: dto.registrationFee,
      tickets: parsedTickets,
    });

    // Start transaction for DB operations only
    const event = this.prisma.$transaction(async (tx) => {
      if (shouldCreateSettlementProfile) {
        await this.ensureCreatorSettlementProfile(tx, userId);
      }

      const event = await tx.event.create({
        data: {
          title: dto.title,
          description: dto.description,
          impactTitle: dto.impactTitle?.trim() || null,
          impactDescription: dto.impactDescription?.trim() || null,
          impactPercentage: this.resolveImpactPercentage(dto.impactPercentage),
          ...this.buildImpactMapCreateData(dto),
          isPhysicalEvent: dto.isPhysicalEvent !== false,
          location: dto.isPhysicalEvent === false ? null : dto.location,
          imageUrl: null,
          thumbnailUrl: null,
          isImageProcessing: !!file,
          links: this.normalizeLinks(dto.links),
          tags: dto.tags,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          reoccurring: dto.reoccurring,
          endRepeat:
            dto.endRepeat && dto.reoccurring !== 'NONE'
              ? new Date(dto.endRepeat)
              : null,
          creatorId: userId,
          communityId: dto.communityId,
          registrationType: dto.registrationType,
          registrationFee:
            dto.registrationType === 'registration'
              ? dto.registrationFee
              : null,
          registrationAttendees:
            dto.registrationType === 'registration'
              ? dto.registrationAttendees
              : null,
          donationTarget:
            dto.registrationType === 'donation' ? dto.donationTarget : null,
        },
      });

      // If tickets exist, create them
      if (dto.registrationType === 'ticket' && parsedTickets.length > 0) {
        await this.eventTicketService.createMany(event.id, parsedTickets, tx);
      }

      return event;
    });

    // 2. Upload image in background (non-blocking)
    if (file) {
      this.uploadImageInBackground((await event).id, userId, file).catch(
        (error) => {
          console.error(`Background image upload failed for event :`, error);
        },
      );
    }

    return event; // Return immediately
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateEventDto,
    file?: Express.Multer.File,
  ) {
    // 1) Fetch event first (auth + old image urls)
    const existingEvent = await this.prisma.event.findUnique({
      where: { id },
    });
    if (!existingEvent) throw new NotFoundException('Event not found');
    if (existingEvent.creatorId !== userId)
      throw new ForbiddenException('Unauthorized');

    try {
      const effectiveRegistrationType = existingEvent.registrationType;
      const effectiveReoccurring = dto.reoccurring ?? existingEvent.reoccurring;
      const parsedTickets =
        effectiveRegistrationType === 'ticket'
          ? this.parseTicketPayloads(dto.tickets)
          : [];

      const result = await this.prisma.$transaction(async (tx) => {
        const eventUpdateData: Prisma.EventUncheckedUpdateInput = {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          impactTitle:
            dto.impactTitle !== undefined
              ? dto.impactTitle?.trim() || null
              : undefined,
          impactDescription:
            dto.impactDescription !== undefined
              ? dto.impactDescription?.trim() || null
              : undefined,
          impactPercentage:
            dto.impactPercentage !== undefined
              ? this.resolveImpactPercentage(dto.impactPercentage)
              : undefined,
          ...this.buildImpactMapUpdateData(dto),
          isPhysicalEvent:
            dto.isPhysicalEvent !== undefined ? dto.isPhysicalEvent : undefined,
          location:
            dto.isPhysicalEvent === false ? null : (dto.location ?? undefined),
          links:
            dto.links !== undefined
              ? this.normalizeLinks(dto.links)
              : undefined,
          tags: dto.tags ?? undefined,
          reoccurring: dto.reoccurring ?? undefined,
          communityId: dto.communityId ?? undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
          isImageProcessing: file ? true : undefined,
        };

        if (dto.endRepeat !== undefined) {
          eventUpdateData.endRepeat =
            dto.endRepeat && effectiveReoccurring !== Reoccurring.NONE
              ? new Date(dto.endRepeat)
              : null;
        } else if (dto.reoccurring === Reoccurring.NONE) {
          eventUpdateData.endRepeat = null;
        }

        if (effectiveRegistrationType === 'registration') {
          eventUpdateData.registrationFee = dto.registrationFee ?? undefined;
          eventUpdateData.registrationAttendees =
            dto.registrationAttendees ?? undefined;
        }

        if (effectiveRegistrationType === 'donation') {
          eventUpdateData.donationTarget = dto.donationTarget ?? undefined;
        }

        // 2) Update the event itself
        const updatedEvent = await tx.event.update({
          where: { id },
          data: eventUpdateData,
        });

        // 3) Ticket updates
        if (
          effectiveRegistrationType === 'ticket' &&
          parsedTickets.length > 0
        ) {
          for (const ticket of parsedTickets) {
            const existingTicket = await tx.eventTicket.findUnique({
              where: { id: ticket.id },
            });
            if (existingTicket) {
              // Update non-quantity fields via Prisma
              await tx.eventTicket.update({
                where: { id: ticket.id },
                data: {
                  type: ticket.type ?? undefined,
                  description: ticket.description ?? undefined,
                  perks: ticket.perks ?? undefined,
                  isVisible: ticket.isVisible ?? undefined,
                  updatedPrice: ticket.updatedPrice ?? undefined,
                },
              });

              // Atomically set: quantity = sold + requested_remaining
              if (typeof ticket.quantity === 'number') {
                await tx.$executeRaw`
                  UPDATE "EventTicket"
                  SET "quantity" = "sold" + ${ticket.quantity}
                  WHERE "id" = ${ticket.id}
                `;
              }
            } else {
              // New ticket
              await tx.eventTicket.create({
                data: {
                  id: ticket.id,
                  eventId: id,
                  type: ticket.type,
                  description: ticket.description,
                  perks: ticket.perks,
                  isVisible: ticket.isVisible,
                  price: ticket.price,
                  quantity: ticket.quantity ?? 0,
                  sold: 0,
                },
              });
            }
          }
        }

        const currentTickets =
          effectiveRegistrationType === 'ticket'
            ? await tx.eventTicket.findMany({
                where: { eventId: id },
                select: { price: true, updatedPrice: true },
              })
            : [];

        if (
          this.requiresSettlementProfile({
            registrationType: effectiveRegistrationType,
            registrationFee: updatedEvent.registrationFee,
            tickets: currentTickets,
          })
        ) {
          await this.ensureCreatorSettlementProfile(tx, userId);
        }

        return updatedEvent;
      });

      // 4) Upload new image in background (if provided)
      if (file) {
        this.uploadImageInBackground(id, userId, file, {
          oldImageUrl: existingEvent.imageUrl,
          oldThumbnailUrl: existingEvent.thumbnailUrl,
        }).catch((error) => {
          console.error(
            `Background image upload failed for event ${id}:`,
            error,
          );
        });
      }

      // 5) Queue job if endDate changed
      if (
        dto.endDate &&
        new Date(dto.endDate).getTime() !==
          new Date(existingEvent.endDate).getTime()
      ) {
        const delayDate = new Date(dto.endDate);
        delayDate.setHours(delayDate.getHours() + 12);
        await this.queueService.addUpdateExpiryJob(id, delayDate.toISOString());
      }

      return result;
    } catch (err) {
      console.error('Event update error:', err);
      throw err;
    }
  }

  private parseTicketPayloads(
    tickets?: Array<string | ParsedEventTicketDto>,
  ): ParsedEventTicketDto[] {
    if (!tickets?.length) {
      return [];
    }

    return tickets.map((ticket) =>
      typeof ticket === 'string' ? JSON.parse(ticket) : ticket,
    );
  }

  private normalizeLinks(links?: string[] | null) {
    if (!links?.length) {
      return [];
    }

    return normalizeEventLinks(links);
  }

  private resolveImpactPercentage(impactPercentage?: number | null) {
    if (impactPercentage === null || impactPercentage === undefined) {
      return null;
    }

    return Math.max(1, Math.min(100, Math.round(Number(impactPercentage))));
  }

  private buildImpactMapCreateData(dto: ImpactMapInput) {
    return {
      impactSdgGoals: this.normalizeJsonArray(dto.impactSdgGoals, 3),
      impactPaths: this.normalizeJsonArray(dto.impactPaths, 3),
      impactCommitments: this.normalizeJsonArray(dto.impactCommitments, 5),
      impactMapSource: this.normalizeImpactMapSource(dto.impactMapSource),
      impactMapGeneratedAt: this.resolveImpactMapGeneratedAt(dto),
    };
  }

  private buildImpactMapUpdateData(
    dto: Partial<ImpactMapInput>,
  ): Prisma.EventUncheckedUpdateInput {
    const data: Prisma.EventUncheckedUpdateInput = {};

    if (dto.impactSdgGoals !== undefined) {
      data.impactSdgGoals = this.normalizeJsonArray(dto.impactSdgGoals, 3);
    }

    if (dto.impactPaths !== undefined) {
      data.impactPaths = this.normalizeJsonArray(dto.impactPaths, 3);
    }

    if (dto.impactCommitments !== undefined) {
      data.impactCommitments = this.normalizeJsonArray(
        dto.impactCommitments,
        5,
      );
    }

    if (dto.impactMapSource !== undefined) {
      data.impactMapSource = this.normalizeImpactMapSource(dto.impactMapSource);
    }

    if (dto.impactMapGeneratedAt !== undefined) {
      data.impactMapGeneratedAt = this.resolveImpactMapGeneratedAt(dto);
    } else if (
      [dto.impactSdgGoals, dto.impactPaths, dto.impactCommitments].some(
        (items) => items !== undefined && items.length > 0,
      )
    ) {
      data.impactMapGeneratedAt = new Date();
    } else if (
      [dto.impactSdgGoals, dto.impactPaths, dto.impactCommitments].every(
        (items) => items !== undefined && items.length === 0,
      )
    ) {
      data.impactMapGeneratedAt = null;
    }

    return data;
  }

  private normalizeJsonArray(
    value: Record<string, unknown>[] | undefined,
    limit: number,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (!Array.isArray(value) || value.length === 0) {
      return Prisma.JsonNull;
    }

    return value
      .filter((item) => item && typeof item === 'object')
      .slice(0, limit)
      .map((item) => ({ ...item })) as Prisma.InputJsonValue;
  }

  private normalizeImpactMapSource(source?: string | null) {
    if (!source?.trim()) {
      return null;
    }

    return source.trim().slice(0, 40);
  }

  private resolveImpactMapGeneratedAt(dto: Partial<ImpactMapInput>) {
    if (dto.impactMapGeneratedAt) {
      const parsed = new Date(dto.impactMapGeneratedAt);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    if (
      [dto.impactSdgGoals, dto.impactPaths, dto.impactCommitments].some(
        (items) => items !== undefined && items.length > 0,
      )
    ) {
      return new Date();
    }

    return null;
  }

  private requiresSettlementProfile(input: {
    registrationType?: string | null;
    registrationFee?: number | null;
    tickets?: Array<{ price?: number | null; updatedPrice?: number | null }>;
  }) {
    if (input.registrationType === 'donation') {
      return true;
    }

    if (input.registrationType === 'registration') {
      return Number(input.registrationFee || 0) > 0;
    }

    if (input.registrationType === 'ticket') {
      return (input.tickets || []).some(
        (ticket) => Number(ticket.updatedPrice ?? ticket.price ?? 0) > 0,
      );
    }

    return false;
  }

  private async ensureCreatorSettlementProfile(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    await tx.creatorSettlementProfile.createMany({
      data: [
        {
          userId,
          status: CreatorSettlementProfileStatus.NOT_STARTED,
        },
      ],
      skipDuplicates: true,
    });
  }

  async findAll() {
    return this.prisma.event.findMany({
      include: { community: true, creator: true },
    });
  }

  async findOne(id: string, userId: string) {
    console.log(userId, 'cuid');
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        community: true,
        creator: {
          select: {
            id: true,
            username: true,
            profilePicUrlTN: true,
          },
        },
        eventTickets: true,
        impactReport: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const hasPaidTicket = event.eventTickets.some((ticket) => ticket.price > 0);
    const hasPaidRegistration =
      event.registrationType === 'registration' &&
      (event.registrationFee || 0) > 0;
    const acceptsDonations = event.registrationType === 'donation';
    const requiresPayment =
      hasPaidTicket || hasPaidRegistration || acceptsDonations;

    const creatorAlatProfile = await this.prisma.creatorAlatProfile.findUnique({
      where: { userId: event.creator.id },
      select: {
        status: true,
        displayName: true,
        businessId: true,
      },
    });
    const creatorSettlementProfile =
      await this.prisma.creatorSettlementProfile.findUnique({
        where: { userId: event.creator.id },
        select: {
          status: true,
        },
      });
    const supportsAlatTransfer =
      requiresPayment &&
      creatorSettlementProfile?.status === 'ACTIVE' &&
      creatorAlatProfile?.status === 'ACTIVE' &&
      Boolean(creatorAlatProfile?.businessId);
    const availableProviders = supportsAlatTransfer
      ? [PaymentProvider.PAYSTACK, PaymentProvider.ALAT_TRANSFER]
      : requiresPayment
        ? [PaymentProvider.PAYSTACK]
        : [];

    // Calculate total donations for this event
    const totalDonationsResult = await this.prisma.donation.aggregate({
      where: {
        eventId: id,
        status: 'completed', // Assuming you have a status field
      },
      _sum: {
        amount: true,
      },
    });

    const totalDonations = totalDonationsResult._sum.amount || 0;

    // ✅ Check if requester follows driver
    const isFollowingCreator = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: userId,
          followingId: event.creator.id,
        },
      },
    });

    // ✅ Check if driver follows requester
    const isFollowedByCreator = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId: event.creator.id,
          followingId: userId,
        },
      },
    });

    return {
      ...event,
      totalDonations, // Add total donations in kobo (or whatever unit your amount is)
      isFollowingCreator: Boolean(isFollowingCreator),
      isFollowedByCreator: Boolean(isFollowedByCreator),
      paymentOptions: {
        requiresPayment,
        supportsPaystack: requiresPayment,
        supportsAlatTransfer,
        availableProviders,
        alatTransferDisplayName: supportsAlatTransfer
          ? creatorAlatProfile?.displayName || null
          : null,
        alatTransferUnavailableReason:
          requiresPayment && !supportsAlatTransfer
            ? 'ALAT transfer is not available for this event yet'
            : null,
        pricingConfig: getCheckoutPricingConfig({ availableProviders }),
      },
    };
  }

  async getImpactReport(userId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        creatorId: true,
        endDate: true,
        impactReport: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return {
      eventId: event.id,
      report: event.impactReport,
      canReport: event.creatorId === userId,
      isEventEnded: this.hasEventEnded(event.endDate),
    };
  }

  async upsertImpactReport(
    userId: string,
    eventId: string,
    dto: UpsertEventImpactReportDto,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        creatorId: true,
        endDate: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.creatorId !== userId) {
      throw new ForbiddenException('Only the event creator can report impact');
    }

    if (!this.hasEventEnded(event.endDate)) {
      throw new BadRequestException(
        'Impact report can only be submitted after the event has ended',
      );
    }

    const outcomes = this.normalizeImpactReportOutcomes(dto.outcomes);
    const evidenceLinks = this.normalizeEvidenceLinks(dto.evidenceLinks);
    const summary = this.normalizeImpactReportSummary(dto.summary);
    const publishedAt = new Date();

    return this.prisma.eventImpactReport.upsert({
      where: { eventId },
      create: {
        eventId,
        creatorId: userId,
        summary,
        outcomes,
        evidenceLinks,
        status: ImpactReportStatus.PUBLISHED,
        publishedAt,
      },
      update: {
        summary,
        outcomes,
        evidenceLinks,
        status: ImpactReportStatus.PUBLISHED,
        publishedAt,
      },
    });
  }

  private hasEventEnded(endDate: Date) {
    return endDate.getTime() <= Date.now();
  }

  private normalizeImpactReportSummary(summary: string) {
    const trimmedSummary = summary.trim();

    if (trimmedSummary.length < 10) {
      throw new BadRequestException(
        'Impact report summary must be at least 10 characters',
      );
    }

    return trimmedSummary.slice(0, 1000);
  }

  private normalizeImpactReportOutcomes(
    outcomes: ImpactReportOutcomeDto[],
  ): Prisma.InputJsonValue {
    const normalized = (outcomes || [])
      .filter((outcome) => outcome && typeof outcome === 'object')
      .map((outcome, index) => {
        const note = outcome.note?.trim().slice(0, 240);

        return {
          id:
            outcome.id?.trim() ||
            `${outcome.type || 'outcome'}_${outcome.value}_${index}`,
          type: outcome.type.trim().slice(0, 80),
          label: outcome.label.trim().slice(0, 120),
          value: Number(outcome.value),
          unit: outcome.unit.trim().slice(0, 40),
          ...(note ? { note } : {}),
        };
      })
      .filter(
        (outcome) =>
          outcome.type &&
          outcome.label &&
          outcome.unit &&
          Number.isFinite(outcome.value) &&
          outcome.value >= 0,
      )
      .slice(0, 20);

    if (!normalized.length) {
      throw new BadRequestException('At least one valid outcome is required');
    }

    return normalized as Prisma.InputJsonValue;
  }

  private normalizeEvidenceLinks(links?: string[] | null) {
    if (!links?.length) {
      return [];
    }

    return normalizeEventLinks(links).slice(0, 5);
  }

  // async update(userId: string, id: string, dto: UpdateEventDto) {
  //   const event = await this.prisma.event.findUnique({ where: { id } });
  //   if (!event) throw new NotFoundException('Event not found');
  //   if (event.creatorId !== userId) throw new ForbiddenException('Unauthorized');

  //   const updated = await this.prisma.event.update({
  //     where: { id },
  //     data: {
  //       ...dto,
  //       startDate: dto.startDate ? new Date(dto.startDate) : undefined,
  //       endDate: dto.endDate ? new Date(dto.endDate) : undefined,
  //     },
  //   });

  //   // Only queue job if endDate changed
  //   if (dto.endDate && new Date(dto.endDate).getTime() !== new Date(event.endDate).getTime()) {
  //     const delayDate = new Date(dto.endDate);
  //     delayDate.setHours(delayDate.getHours() + 12); // ✅ Add 12 hours

  //     await this.queueService.addUpdateExpiryJob(id, delayDate.toISOString());
  //   }

  //   return updated;
  // }

  async remove(userId: string, id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.creatorId !== userId)
      throw new ForbiddenException('Unauthorized');

    await this.prisma.event.delete({ where: { id } });
    return { message: 'Event deleted successfully' };
  }

  async getForYouEvents(userId: string) {
    // ⏰ 24hr grace period
    const nowMinus24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get user preferences
    const userPreference = await this.prisma.userPreference.findUnique({
      where: { userId },
    });

    const preferredTags = userPreference?.eventTypes || [];
    const preferredLocations = userPreference?.location || '';
    const preferredInterests = userPreference?.interests || [];

    const events: any[] = [];
    const eventIds = new Set<string>();

    /**
     * 1️⃣ Events the user created
     */
    const createdEvents = await this.prisma.event.findMany({
      where: {
        creatorId: userId,
        endDate: { gte: nowMinus24h },
      },
      include: eventCardInclude,
    });

    for (const ev of createdEvents) {
      if (!eventIds.has(ev.id)) {
        events.push(ev);
        eventIds.add(ev.id);
      }
    }

    /**
     * 2️⃣ Events the user registered for
     */
    const registrations = await this.prisma.registration.findMany({
      where: { userId },
      include: {
        event: {
          include: eventCardInclude,
        },
      },
    });

    const registeredEvents = registrations
      .map((r) => r.event)
      .filter(
        (e): e is NonNullable<typeof e> => !!e && e.endDate >= nowMinus24h,
      );

    for (const ev of registeredEvents) {
      if (!eventIds.has(ev.id)) {
        events.push(ev);
        eventIds.add(ev.id);
      }
    }

    /**
     * 3️⃣ Ticketed events
     */
    const tickets = await this.prisma.ticket.findMany({
      where: { userId },
      include: {
        eventTicket: {
          include: {
            event: {
              include: eventCardInclude,
            },
          },
        },
      },
    });

    const ticketedEvents = tickets
      .map((t) => t.eventTicket?.event)
      .filter(
        (e): e is NonNullable<typeof e> => !!e && e.endDate >= nowMinus24h,
      );

    for (const ev of ticketedEvents) {
      if (!eventIds.has(ev.id)) {
        events.push(ev);
        eventIds.add(ev.id);
      }
    }

    /**
     * 4️⃣ Preference-based events
     */
    if (events.length < 10) {
      const preferenceEvents = await this.prisma.event.findMany({
        where: {
          endDate: { gte: nowMinus24h },
          OR: [
            { tags: { hasSome: preferredTags } },
            { location: preferredLocations },
            { tags: { hasSome: preferredInterests } },
          ],
        },
        include: eventCardInclude,
        take: 20,
      });

      for (const ev of preferenceEvents) {
        if (!eventIds.has(ev.id) && events.length < 10) {
          events.push(ev);
          eventIds.add(ev.id);
        }
      }
    }

    /**
     * 5️⃣ Fallback events
     */
    if (events.length < 10) {
      const fallbackEvents = await this.prisma.event.findMany({
        where: { endDate: { gte: nowMinus24h } },
        include: eventCardInclude,
        orderBy: { startDate: 'asc' },
        take: 20,
      });

      for (const ev of fallbackEvents) {
        if (!eventIds.has(ev.id) && events.length < 10) {
          events.push(ev);
          eventIds.add(ev.id);
        }
      }
    }

    /**
     * 6️⃣ Add reasons
     */
    const eventResults = events.map((event) => {
      let reason = 'Recommended';

      if (createdEvents.find((e) => e.id === event.id)) {
        reason = 'You created this event';
      } else if (registeredEvents.find((e) => e.id === event.id)) {
        reason = 'You registered for this event';
      } else if (ticketedEvents.find((e) => e.id === event.id)) {
        reason = 'You already have tickets for this event';
      } else if (
        (preferredTags.length &&
          event.tags.some((tag) => preferredTags.includes(tag))) ||
        (preferredInterests.length &&
          event.tags.some((tag) => preferredInterests.includes(tag))) ||
        (preferredLocations.length &&
          preferredLocations.includes(event.location))
      ) {
        reason = 'Based on your preferences';
      } else {
        reason = 'Popular or upcoming event';
      }

      return { ...event, reason };
    });

    const eventsWithPricing = eventResults.map((event) => ({
      ...event,
      lowestTicketPrice: this.getLowestTicketPrice(event),
    }));

    return eventsWithPricing.slice(0, 10); // ensure max 10
  }

  async getAllUserEvents(userId: string, page = 1, pageSize = 10) {
    console.log(userId, page, pageSize);
    const events: any[] = [];
    const eventIds = new Set<string>();

    /**
     * 1️⃣ Events the user created
     */
    const createdEvents = await this.prisma.event.findMany({
      where: { creatorId: userId },
      include: eventCardInclude,
    });

    for (const ev of createdEvents) {
      if (!eventIds.has(ev.id)) {
        events.push({ ...ev, reason: 'You created this event' });
        eventIds.add(ev.id);
      }
    }

    /**
     * 2️⃣ Events the user registered for
     */
    const registrations = await this.prisma.registration.findMany({
      where: { userId },
      include: {
        event: {
          include: eventCardInclude,
        },
      },
    });

    const registeredEvents = registrations
      .map((r) => r.event)
      .filter((e): e is NonNullable<typeof e> => !!e);

    for (const ev of registeredEvents) {
      if (!eventIds.has(ev.id)) {
        events.push({ ...ev, reason: 'You registered for this event' });
        eventIds.add(ev.id);
      }
    }

    /**
     * 3️⃣ Ticketed events
     */
    const tickets = await this.prisma.ticket.findMany({
      where: { userId },
      include: {
        eventTicket: {
          include: {
            event: {
              include: eventCardInclude,
            },
          },
        },
      },
    });

    const ticketedEvents = tickets
      .map((t) => t.eventTicket?.event)
      .filter((e): e is NonNullable<typeof e> => !!e);

    for (const ev of ticketedEvents) {
      if (!eventIds.has(ev.id)) {
        events.push({
          ...ev,
          reason: 'You already have tickets for this event',
        });
        eventIds.add(ev.id);
      }
    }

    /**
     * 🔄 Sort newest first
     */
    events.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

    /**
     * 📄 Paginate
     */
    const total = events.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedEvents = events
      .slice(startIndex, startIndex + pageSize)
      .map((event) => ({
        ...event,
        lowestTicketPrice: this.getLowestTicketPrice(event),
      }));

    console.log({
      total,
      page,
      pageSize,
      data: paginatedEvents,
    });
    return {
      total,
      page,
      pageSize,
      data: paginatedEvents,
    };
  }

  private async uploadImageInBackground(
    eventId: string,
    userId: string,
    file: Express.Multer.File,
    options?: {
      oldImageUrl?: string | null;
      oldThumbnailUrl?: string | null;
      retries?: number;
    },
  ) {
    const {
      oldImageUrl = null,
      oldThumbnailUrl = null,
      retries = 3,
    } = options || {};

    let uploadedImage: { url: string; thumbnailUrl?: string } | null = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Upload the image
        uploadedImage = await this.mediaService.uploadFile(
          file,
          `events/${userId}`,
        );

        // Update event with new image URLs and clear processing flag
        await this.prisma.event.update({
          where: { id: eventId },
          data: {
            imageUrl: uploadedImage.url,
            thumbnailUrl: uploadedImage.thumbnailUrl,
            isImageProcessing: false, // Clear processing flag
          },
        });

        console.log(
          `✅ Image uploaded for event ${eventId} (attempt ${attempt})`,
        );

        // Delete old images (only for updates, not for create)
        if (oldImageUrl && oldImageUrl !== uploadedImage.url) {
          await this.mediaService.deleteFile(oldImageUrl);
        }
        if (oldThumbnailUrl && oldThumbnailUrl !== uploadedImage.thumbnailUrl) {
          await this.mediaService.deleteFile(oldThumbnailUrl);
        }

        return uploadedImage;
      } catch (error) {
        console.error(
          `❌ Upload attempt ${attempt}/${retries} failed for event ${eventId}:`,
          error,
        );

        if (attempt === retries) {
          // Final attempt failed, clear processing flag
          await this.prisma.event.update({
            where: { id: eventId },
            data: { isImageProcessing: false },
          });

          throw error;
        }

        // Wait before retrying (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async getImageStatus(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        imageUrl: true,
        thumbnailUrl: true,
        isImageProcessing: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    return {
      eventId: event.id,
      hasImage: !!event.imageUrl,
      isProcessing: event.isImageProcessing,
      imageUrl: event.imageUrl,
      thumbnailUrl: event.thumbnailUrl,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }
}

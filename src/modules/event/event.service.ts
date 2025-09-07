import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { CarpoolQueueService } from 'src/queue/carpool/queue.service';
import { MediaService } from '../media/media.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';




@Injectable()
export class EventService {
  constructor(private prisma: PrismaService, 
    private readonly queueService: CarpoolQueueService, // Injected
    private eventTicketService: EventTicketService,
    private mediaService: MediaService

  ) {}

  async create(
    userId: string,
    dto: CreateEventDto,
    file?: Express.Multer.File
  ) {
    let imageUrl = dto.imageUrl;
    let thumbnailUrl: string | null = null;
  
    // Upload image BEFORE starting transaction
    if (!imageUrl && file) {
      const { url, thumbnailUrl: thumb } = await this.mediaService.uploadFile(
        file,
        `events/${userId}`
      );
      imageUrl = url;
      thumbnailUrl = thumb;
    }
  
    // Start transaction for DB operations only
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          title: dto.title,
          description: dto.description,
          location: dto.location,
          imageUrl,
          thumbnailUrl,
          links: dto.links,
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
        },
      });
  
      // If tickets exist, create them
      console.log(dto.tickets)
      if (
        dto.registrationType === 'ticket' &&
        dto.tickets &&
        dto.tickets.length > 0
      ) {
        const trasformed = dto.tickets.map(ticket=>JSON.parse(ticket))
        console.log(trasformed)
        await this.eventTicketService.createMany(event.id, trasformed, tx);
      }
  
      return event;
    });
  }
  


  async update(
    userId: string,
    id: string,
    dto: UpdateEventDto,
    file?: Express.Multer.File
  ) {
    // 1) Fetch event first (auth + old image urls)
    const existingEvent = await this.prisma.event.findUnique({
      where: { id },
    });
    if (!existingEvent) throw new NotFoundException('Event not found');
    if (existingEvent.creatorId !== userId) throw new ForbiddenException('Unauthorized');
  
    // 2) (Optional) new image upload before DB tx
    let uploadedImage: { url: string; thumbnailUrl?: string } | null = null;
    if (file) {
      uploadedImage = await this.mediaService.uploadFile(file, `events/${userId}`);
    }
  
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // 3) Update the event itself
        const updatedEvent = await tx.event.update({
          where: { id },
          data: {
            // spread only fields you actually allow from dto
            title: dto.title ?? undefined,
            description: dto.description ?? undefined,
            location: dto.location ?? undefined,
            links: dto.links ?? undefined,
            tags: dto.tags ?? undefined,
            reoccurring: dto.reoccurring ?? undefined,
            endRepeat:
              dto.endRepeat && dto.reoccurring !== 'NONE'
                ? new Date(dto.endRepeat)
                : dto.endRepeat === undefined
                ? undefined
                : null,
            communityId: dto.communityId ?? undefined,
            registrationType: dto.registrationType ?? undefined,
            registrationFee:
              dto.registrationType === 'registration' ? dto.registrationFee : null,
            registrationAttendees:
              dto.registrationType === 'registration' ? dto.registrationAttendees : null,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            endDate: dto.endDate ? new Date(dto.endDate) : undefined,
            // image fields (use new if uploaded)
            imageUrl: uploadedImage ? uploadedImage.url : undefined,
            thumbnailUrl: uploadedImage?.thumbnailUrl ?? undefined,
          },
        });
  
        // 4) Ticket updates (no deletion). Interpret dto.quantity as "remaining to sell"
        if (dto.registrationType === 'ticket' && dto.tickets && dto.tickets.length > 0) {
          for (const raw of dto.tickets) {
            const ticket = typeof raw === 'string' ? JSON.parse(raw) : raw;
  
            console.log(ticket.id,"ticketid")

            const existingTicket = await tx.eventTicket.findUnique({
              where: { id: ticket.id }
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
              // New ticket: sold is 0, so total = requested_remaining
              await tx.eventTicket.create({
                data: {
                  id:ticket.id,
                  eventId: id,
                  type: ticket.type,
                  description: ticket.description,
                  perks: ticket.perks,
                  isVisible: ticket.isVisible,
                  price: ticket.price,            // new tickets use price
                  quantity: ticket.quantity ?? 0, // remaining to sell
                  sold: 0,
                },
              });
            }
          }
        }
  
        return updatedEvent;
      });
  
      // 5) After successful tx: if we uploaded a new image, delete the old ones
      if (uploadedImage) {
        if (existingEvent.imageUrl && existingEvent.imageUrl !== uploadedImage.url) {
          await this.mediaService.deleteFile(existingEvent.imageUrl);
        }
        if (
          existingEvent.thumbnailUrl &&
          existingEvent.thumbnailUrl !== uploadedImage.thumbnailUrl
        ) {
          await this.mediaService.deleteFile(existingEvent.thumbnailUrl);
        }
      }
  
      // 6) Queue job if endDate changed
      if (
        dto.endDate &&
        new Date(dto.endDate).getTime() !== new Date(existingEvent.endDate).getTime()
      ) {
        const delayDate = new Date(dto.endDate);
        delayDate.setHours(delayDate.getHours() + 12);
        await this.queueService.addUpdateExpiryJob(id, delayDate.toISOString());
      }
  
      return result;
    } catch (err) {
      // Cleanup newly uploaded image if DB failed
      if (uploadedImage) {
        await this.mediaService.deleteFile(uploadedImage.url);
        if (uploadedImage.thumbnailUrl) {
          await this.mediaService.deleteFile(uploadedImage.thumbnailUrl);
        }
      }
      throw err;
    }
  }
  
  
  
  

  async findAll() {
    return this.prisma.event.findMany({
      include: { community: true, creator: true },
    });
  }

  async findOne(id: string) {
   
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { community: true, 
      creator: {
        select:{
          id:true,
          username:true,
          profilePicUrlTN:true
        }
        
      }, eventTickets: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
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
    if (event.creatorId !== userId) throw new ForbiddenException('Unauthorized');

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
    const preferredLocations = userPreference?.location || "";
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
      include: {
        community: true,
        creator: {
          select: {
            id: true,
            username: true,
            profilePicUrlTN: true,
          },
        },
      },
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
          include: {
            community: true,
            creator: {
              select: {
                id: true,
                username: true,
                profilePicUrlTN: true,
              },
            },
          },
        },
      },
    });
  
    const registeredEvents = registrations
      .map((r) => r.event)
      .filter(
        (e): e is NonNullable<typeof e> =>
          !!e && e.endDate >= nowMinus24h,
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
              include: {
                community: true,
                creator: {
                  select: {
                    id: true,
                    username: true,
                    profilePicUrlTN: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  
    const ticketedEvents = tickets
      .map((t) => t.eventTicket?.event)
      .filter(
        (e): e is NonNullable<typeof e> =>
          !!e && e.endDate >= nowMinus24h,
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
        include: {
          community: true,
          creator: {
            select: {
              id: true,
              username: true,
              profilePicUrlTN: true,
            },
          },
        },
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
        include: {
          community: true,
          creator: {
            select: {
              id: true,
              username: true,
              profilePicUrlTN: true,
            },
          },
        },
        orderBy: { startDate: "asc" },
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
      let reason = "Recommended";
  
      if (createdEvents.find((e) => e.id === event.id)) {
        reason = "You created this event";
      } else if (registeredEvents.find((e) => e.id === event.id)) {
        reason = "You registered for this event";
      } else if (ticketedEvents.find((e) => e.id === event.id)) {
        reason = "You already have tickets for this event";
      } else if (
        (preferredTags.length &&
          event.tags.some((tag) => preferredTags.includes(tag))) ||
        (preferredInterests.length &&
          event.tags.some((tag) => preferredInterests.includes(tag))) ||
        (preferredLocations.length &&
          preferredLocations.includes(event.location))
      ) {
        reason = "Based on your preferences";
      } else {
        reason = "Popular or upcoming event";
      }
  
      return { ...event, reason };
    });
  
    return eventResults.slice(0, 10); // ensure max 10
  }

  async getAllUserEvents(userId: string, page = 1, pageSize = 10) {


    console.log(userId,page,pageSize)
    const events: any[] = [];
    const eventIds = new Set<string>();
  
    /**
     * 1️⃣ Events the user created
     */
    const createdEvents = await this.prisma.event.findMany({
      where: { creatorId: userId },
      include: {
        community: true,
        creator: {
          select: {
            id: true,
            username: true,
            profilePicUrlTN: true,
          },
        },
      },
    });
  
    for (const ev of createdEvents) {
      if (!eventIds.has(ev.id)) {
        events.push({ ...ev, reason: "You created this event" });
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
          include: {
            community: true,
            creator: {
              select: {
                id: true,
                username: true,
                profilePicUrlTN: true,
              },
            },
          },
        },
      },
    });
  
    const registeredEvents = registrations
      .map((r) => r.event)
      .filter((e): e is NonNullable<typeof e> => !!e);
  
    for (const ev of registeredEvents) {
      if (!eventIds.has(ev.id)) {
        events.push({ ...ev, reason: "You registered for this event" });
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
              include: {
                community: true,
                creator: {
                  select: {
                    id: true,
                    username: true,
                    profilePicUrlTN: true,
                  },
                },
              },
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
        events.push({ ...ev, reason: "You already have tickets for this event" });
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
    const paginatedEvents = events.slice(startIndex, startIndex + pageSize);
  
    console.log({
      total,
      page,
      pageSize,
      data: paginatedEvents,
    })
    return {
      total,
      page,
      pageSize,
      data: paginatedEvents,
    };
  }
  
  
  
  
  
}

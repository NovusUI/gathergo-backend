import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetEventsDto, EventFilter } from '../dto/get-events.dto';

@Injectable()
export class EventsService {
  constructor(private prisma: PrismaService) {}

  async getEvents(userId: string, dto: GetEventsDto) {
    const { page = 1, pageSize = 10, filter = EventFilter.UPCOMING } = dto;
    const skip = (page - 1) * pageSize;
    const now = new Date();

    let whereClause: any = {
      creatorId: userId,
    };

    // Apply filter
    if (filter === EventFilter.UPCOMING) {
      whereClause.endDate = { gte: now };
    } else if (filter === EventFilter.PAST) {
      whereClause.endDate = { lt: now };
    }
    // 'all' shows both, so no date filter

    const total = await this.prisma.event.count({
      where: whereClause,
    });

    const events = await this.prisma.event.findMany({
      where: whereClause,
      include: {
        eventTickets: {
          select: {
            sold: true,
            quantity: true,
            price: true,
          },
        },
        donations: {
          select: {
            amount: true,
          },
        },
        Registration: {
          select: {
            id: true,
          },
        },
        community: {
          select: {
            name: true,
          },
        },
      },
      orderBy:
        filter === EventFilter.PAST
          ? { endDate: 'desc' }
          : { startDate: 'asc' },
      skip,
      take: pageSize,
    });

    const formattedEvents = events.map((event) =>
      this.formatEvent(event, filter),
    );

    return {
      data: formattedEvents,
      page,
      pageSize,
      filter,
      total,
    };
  }

  private formatEvent(event: any, filter: EventFilter) {
    let raised = 0;
    let participants = 0;
    let goal = 0;

    switch (event.registrationType) {
      case 'ticket':
        raised = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.sold * ticket.price,
          0,
        );
        participants = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.sold,
          0,
        );
        goal = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.quantity * ticket.price,
          0,
        );
        break;

      case 'donation':
        raised =
          event.donations.reduce(
            (sum: number, donation: any) => sum + donation.amount,
            0,
          ) / 100;
        goal = event.donationTarget || 0;
        participants = event.donations.length;
        break;

      case 'registration':
        raised = event.Registration.length * (event.registrationFee || 0);
        goal =
          (event.registrationAttendees || 0) * (event.registrationFee || 0);
        participants = event.Registration.length;
        break;
    }

    const progress = goal > 0 ? Math.min((raised / goal) * 100, 100) : 0;
    const now = new Date();
    const type = event.endDate < now ? 'past' : 'upcoming';

    return {
      id: event.id,
      title: event.title,
      description: event.description || '',
      progress: Math.round(progress),
      participants,
      raised,
      goal,
      date: event.startDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      type,
    };
  }
}

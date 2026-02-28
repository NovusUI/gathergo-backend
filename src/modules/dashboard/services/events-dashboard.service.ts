import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { formatPayment } from 'src/utils';

@Injectable()
export class EventsDashboardService {
  constructor(private prisma: PrismaService) {}

  async getEventDashboardData(userId: string, eventId: string) {
    // Check if user has access to this event
    const hasAccess = await this.checkUserAccess(userId, eventId);
    if (!hasAccess) {
      throw new NotFoundException('Event not found or access denied');
    }

    const limit = 10;

    // Get event with all related data
    const event = await this.getEventWithDetails(eventId, userId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Format event based on type
    const formattedEvent = this.formatEventData(event);

    const payments = await this.getUserPayments(eventId, 0, limit);

    const hasMore = payments.length === limit;

    return {
      event: formattedEvent,
      payments: payments.map(formatPayment),
      hasMore,
    };
  }

  private async checkUserAccess(
    userId: string,
    eventId: string,
  ): Promise<boolean> {
    const event = await this.prisma.event.findFirst({
      where: {
        id: eventId,
        creatorId: userId,
      },
    });

    return !!event;
  }

  private async getUserPayments(eventId: string, skip: number, limit: number) {
    return this.prisma.transactionReference.findMany({
      where: {
        eventId: eventId,
        status: 'SUCCESS',
      },
      include: {
        event: {
          select: { title: true },
        },
        user: {
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }

  private async getEventWithDetails(eventId: string, userId: string) {
    return this.prisma.event.findUnique({
      where: { id: eventId, creatorId: userId },
      include: {
        eventTickets: {
          where: { isVisible: true },
          include: {
            tickets: {
              select: { id: true },
            },
          },
        },
        donations: {
          include: {
            user: {
              select: { username: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        Registration: {
          include: {
            user: {
              select: { username: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        community: {
          select: { name: true },
        },
        creator: {
          select: { username: true },
        },
      },
    });
  }

  private formatEventData(event: any) {
    const baseData = {
      id: event.id,
      title: event.title,
      description: event.description || '',
      date: event.startDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      accountInfo: `${event.community?.name || event.creator?.name} | ${event.title}`,
    };

    switch (event.registrationType) {
      case 'donation':
        return this.formatDonationEvent(event, baseData);
      case 'ticket':
        return this.formatTicketEvent(event, baseData);
      case 'registration':
        return this.formatRegistrationEvent(event, baseData);
      default:
        return baseData;
    }
  }

  private formatDonationEvent(event: any, baseData: any) {
    const totalDonations =
      event.donations.reduce((sum: number, d: any) => sum + d.amount, 0) / 100;
    const target = event.donationTarget || 0;
    const progress =
      target > 0 ? Math.min((totalDonations / target) * 100, 100) : 0;
    const participants = event.donations.length;

    const donationsByDay = this.groupByDay(
      event.donations,
      'createdAt',
      'amount',
      7,
      'sum',
    );

    return {
      ...baseData,
      type: 'donation' as const,
      target,
      raised: totalDonations,
      progress,
      participants,
      donations: donationsByDay,
    };
  }

  private formatTicketEvent(event: any, baseData: any) {
    const ticketTypes = event.eventTickets.map((ticket: any) => ({
      id: ticket.id,
      name: ticket.type,
      price: ticket.price,
      ticketsSold: ticket.sold,
      ticketsTotal: ticket.quantity,
      ticketsLeft: ticket.quantity - ticket.sold,
      progress: ticket.quantity > 0 ? (ticket.sold / ticket.quantity) * 100 : 0,
      revenue: ticket.sold * ticket.price,
    }));

    const totalTicketsSold = ticketTypes.reduce(
      (sum: number, t: any) => sum + t.ticketsSold,
      0,
    );
    const totalTicketsAvailable = ticketTypes.reduce(
      (sum: number, t: any) => sum + t.ticketsTotal,
      0,
    );
    const totalTicketsLeft = totalTicketsAvailable - totalTicketsSold;
    const totalProgress =
      totalTicketsAvailable > 0
        ? (totalTicketsSold / totalTicketsAvailable) * 100
        : 0;
    const totalRevenue = ticketTypes.reduce(
      (sum: number, t: any) => sum + t.revenue,
      0,
    );
    const isSoldOut = totalTicketsLeft === 0;

    const salesByDay = this.groupTicketSalesByDay(event.eventTickets, 7);

    return {
      ...baseData,
      type: 'ticket' as const,
      ticketTypes,
      totalTicketsSold,
      totalTicketsAvailable,
      totalTicketsLeft,
      totalProgress,
      revenue: totalRevenue,
      isSoldOut,
      sales: salesByDay,
    };
  }

  private formatRegistrationEvent(event: any, baseData: any) {
    const registrations = event.Registration.length;
    const goal = event.registrationAttendees || 0;
    const progress = goal > 0 ? Math.min((registrations / goal) * 100, 100) : 0;
    const revenue = registrations * (event.registrationFee || 0);

    const registrationsByDay = this.groupByDay(
      event.Registration,
      'createdAt',
      null,
      7,
      'count',
    );

    return {
      ...baseData,
      type: 'registration' as const,
      price: event.registrationFee || 0,
      registrations,
      registrationsGoal: goal,
      revenue,
      registrationsData: registrationsByDay,
      progress,
    };
  }

  private groupByDay(
    items: any[],
    dateField: string,
    amountField: string | null,
    days: number,
    mode: 'sum' | 'count' = 'sum',
  ) {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = Array(days)
      .fill(0)
      .map((_, i) => ({
        day: daysOfWeek[i],
        amount: 0,
        tickets: 0,
        registrations: 0,
      }));

    const now = new Date();
    items.forEach((item: any) => {
      const date = new Date(item[dateField]);
      const dayDiff = Math.floor(
        (now.getTime() - date.getTime()) / (1000 * 3600 * 24),
      );

      if (dayDiff < days) {
        const dayIndex = (now.getDay() - dayDiff + 7) % 7;

        if (mode === 'count') {
          result[dayIndex].registrations += 1;
        } else if (amountField) {
          result[dayIndex].amount += (item[amountField] || 0) / 100;
        }
      }
    });

    return result;
  }

  private groupTicketSalesByDay(tickets: any[], days: number) {
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = Array(days)
      .fill(0)
      .map((_, i) => ({
        day: daysOfWeek[i],
        tickets: 0,
        amount: 0,
      }));

    tickets.forEach((ticket: any) => {
      const ticketsPerDay = Math.floor(ticket.sold / days);
      for (let i = 0; i < days; i++) {
        result[i].tickets += ticketsPerDay;
        result[i].amount += ticketsPerDay * ticket.price;
      }
    });

    return result;
  }
}

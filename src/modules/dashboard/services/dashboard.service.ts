import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetEventsDto, EventFilter } from '../dto/get-events.dto';
import { formatPayment } from 'src/utils';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboardData(userId: string, page: number = 1) {
    const limit = 10;
    const skip = (page - 1) * limit;
    const now = new Date();

    // Get upcoming events
    const upcomingEvents = await this.getUserEvents(
      userId,
      {
        endDate: { gte: now },
      },
      4,
    );

    // Get past events
    const pastEvents = await this.getUserEvents(
      userId,
      {
        endDate: { lt: now },
      },
      4,
    );

    // Format events
    const events = [
      ...upcomingEvents.map((event) =>
        this.formatEventForDashboard(event, 'upcoming'),
      ),
      ...pastEvents.map((event) => this.formatEventForDashboard(event, 'past')),
    ];

    // Get recent payments
    const payments = await this.getUserPayments(userId, skip, limit);

    const hasMore = payments.length === limit;

    return {
      events,
      payments: payments.map(formatPayment),
      hasMore,
      page,
    };
  }

  private async getUserEvents(userId: string, dateFilter: any, take: number) {
    return this.prisma.event.findMany({
      where: {
        creatorId: userId, // Only events user CREATED/OWNS
        ...dateFilter,
      },
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
      },
      orderBy: dateFilter.endDate?.gte
        ? { startDate: 'asc' }
        : { endDate: 'desc' },
      take,
    });
  }

  private async getUserPayments(userId: string, skip: number, limit: number) {
    return this.prisma.transactionReference.findMany({
      where: {
        userId,
        status: 'SUCCESS',
        eventId: { not: null },
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

  private formatEventForDashboard(event: any, type: 'upcoming' | 'past') {
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

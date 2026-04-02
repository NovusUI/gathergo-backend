import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PaymentType, TransactionStatusType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { formatPayment } from 'src/utils';
import { InternalAdminOverviewQueryDto } from '../dto/internal-overview.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getInternalOverview(
    dto: InternalAdminOverviewQueryDto,
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);

    const now = new Date();
    const upcomingLimit = Math.min(dto.upcomingLimit || 6, 12);
    const activityLimit = Math.min(dto.activityLimit || 6, 12);

    const [
      totalEvents,
      upcomingEventsCount,
      liveEventsCount,
      ticketEventCount,
      donationEventCount,
      registrationEventCount,
      successfulTransactionsCount,
      grossProcessedAggregate,
      ticketSalesAggregate,
      registrationSalesAggregate,
      donationAmountAggregate,
      donationCount,
      registrationCount,
      ticketUnitsSoldAggregate,
      upcomingEvents,
      recentActivity,
    ] = await Promise.all([
      this.prisma.event.count(),
      this.prisma.event.count({
        where: {
          endDate: { gte: now },
        },
      }),
      this.prisma.event.count({
        where: {
          startDate: { lte: now },
          endDate: { gte: now },
        },
      }),
      this.prisma.event.count({
        where: {
          registrationType: 'ticket',
        },
      }),
      this.prisma.event.count({
        where: {
          registrationType: 'donation',
        },
      }),
      this.prisma.event.count({
        where: {
          registrationType: 'registration',
        },
      }),
      this.prisma.transactionReference.count({
        where: {
          status: TransactionStatusType.SUCCESS,
        },
      }),
      this.prisma.transactionReference.aggregate({
        where: {
          status: TransactionStatusType.SUCCESS,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.transactionReference.aggregate({
        where: {
          status: TransactionStatusType.SUCCESS,
          paymentType: PaymentType.TICKET,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.transactionReference.aggregate({
        where: {
          status: TransactionStatusType.SUCCESS,
          paymentType: PaymentType.REGISTRATION,
        },
        _sum: {
          amount: true,
        },
      }),
      this.prisma.donation.aggregate({
        _sum: {
          amount: true,
        },
      }),
      this.prisma.donation.count(),
      this.prisma.registration.count(),
      this.prisma.eventTicket.aggregate({
        _sum: {
          sold: true,
        },
      }),
      this.prisma.event.findMany({
        where: {
          endDate: { gte: now },
        },
        orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
        take: upcomingLimit,
        select: {
          id: true,
          title: true,
          registrationType: true,
          location: true,
          startDate: true,
          endDate: true,
          donationTarget: true,
          registrationAttendees: true,
          registrationFee: true,
          creator: {
            select: {
              id: true,
              username: true,
              fullName: true,
              email: true,
            },
          },
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
      }),
      this.prisma.transactionReference.findMany({
        where: {
          status: TransactionStatusType.SUCCESS,
          eventId: { not: null },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: activityLimit,
        select: {
          id: true,
          paymentType: true,
          amount: true,
          creatorPayable: true,
          settlementStatus: true,
          riskStatus: true,
          createdAt: true,
          event: {
            select: {
              id: true,
              title: true,
              registrationType: true,
            },
          },
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
            },
          },
          creator: {
            select: {
              id: true,
              username: true,
              fullName: true,
            },
          },
        },
      }),
    ]);

    return {
      summary: {
        totalEvents,
        upcomingEvents: upcomingEventsCount,
        liveEvents: liveEventsCount,
        successfulTransactions: successfulTransactionsCount,
        grossProcessed: this.toCurrencyAmount(
          grossProcessedAggregate._sum.amount || 0,
        ),
      },
      channels: [
        {
          key: 'ticket',
          label: 'Ticket Sales',
          eventCount: ticketEventCount,
          participants: ticketUnitsSoldAggregate._sum.sold || 0,
          grossAmount: this.toCurrencyAmount(ticketSalesAggregate._sum.amount || 0),
        },
        {
          key: 'donation',
          label: 'Donations',
          eventCount: donationEventCount,
          participants: donationCount,
          grossAmount: this.toCurrencyAmount(
            donationAmountAggregate._sum.amount || 0,
          ),
        },
        {
          key: 'registration',
          label: 'Registrations',
          eventCount: registrationEventCount,
          participants: registrationCount,
          grossAmount: this.toCurrencyAmount(
            registrationSalesAggregate._sum.amount || 0,
          ),
        },
      ],
      upcomingEvents: upcomingEvents.map((event) =>
        this.formatInternalOverviewEvent(event, now),
      ),
      recentActivity: recentActivity.map((transaction) =>
        this.formatInternalActivity(transaction),
      ),
    };
  }

  async getHomeCards(userId: string) {
    const now = new Date();

    const [featuredEvents, activeCarpools] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          endDate: { gte: now },
          OR: [
            { impactPercentage: { not: null } },
            { impactTitle: { not: null } },
            { registrationType: 'donation' },
          ],
        },
        orderBy: [{ impactPercentage: 'desc' }, { startDate: 'asc' }],
        take: 2,
        select: {
          id: true,
          title: true,
          imageUrl: true,
          thumbnailUrl: true,
          impactTitle: true,
          impactPercentage: true,
          registrationType: true,
        },
      }),
      this.prisma.carpool.count({
        where: {
          isDeleted: false,
          status: 'ACTIVE',
          OR: [
            { expiresAt: { gte: now } },
            {
              event: {
                endDate: { gte: now },
              },
            },
          ],
        },
      }),
    ]);

    const [featuredEvent, secondEvent] = featuredEvents;

    return [
      {
        id: featuredEvent ? `impact-${featuredEvent.id}` : 'impact-fallback',
        key: 'impact',
        variant: featuredEvent?.imageUrl || featuredEvent?.thumbnailUrl ? 'image' : 'copy',
        eyebrow: 'Impact spotlight',
        title:
          featuredEvent?.title ||
          'Discover events that do more than gather people',
        body: this.buildImpactCardBody(featuredEvent),
        cta:
          featuredEvent?.registrationType === 'donation'
            ? 'Donate now'
            : 'See event',
        route: featuredEvent ? `/event/${featuredEvent.id}` : null,
        imageUrl: featuredEvent?.imageUrl || featuredEvent?.thumbnailUrl || null,
        thumbnailUrl: featuredEvent?.thumbnailUrl || null,
        eventId: featuredEvent?.id || null,
        icon: 'sparkles-outline',
        accentColor: '#0FF1CF',
      },
      {
        id: `ride-${userId}`,
        key: 'ride',
        variant: 'copy',
        eyebrow: 'Find a ride',
        title: 'Shared rides make turnout easier',
        body:
          activeCarpools > 0
            ? `${activeCarpools} active carpool option${activeCarpools === 1 ? '' : 's'} can help people show up without the usual transport friction.`
            : 'Create or join a ride so getting to the event feels as intentional as the event itself.',
        cta: 'See rides',
        route: null,
        imageUrl: null,
        thumbnailUrl: null,
        eventId: null,
        icon: 'car-sport-outline',
        accentColor: '#0FF1CF',
      },
      {
        id: secondEvent ? `circle-${secondEvent.id}` : `circle-${userId}`,
        key: 'circle',
        variant: 'copy',
        eyebrow: 'Circle',
        title: secondEvent?.impactTitle
          ? `Circle will connect people around ${secondEvent.impactTitle}`
          : 'Circle will connect people around shared causes and momentum',
        body:
          secondEvent?.title
            ? `${secondEvent.title} can become more than a moment when people have a space to keep the energy going.`
            : 'Give communities a place to keep the conversation going before, during, and after the event.',
        cta: 'Preview Circle',
        route: '/circle',
        imageUrl: null,
        thumbnailUrl: null,
        eventId: null,
        icon: 'people-outline',
        accentColor: '#0FF1CF',
      },
    ];
  }

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

  private buildImpactCardBody(
    event?: {
      impactTitle: string | null;
      impactPercentage: number | null;
      registrationType: string;
    } | null,
  ) {
    if (!event) {
      return 'Explore events where turnout, spending, and generosity all point toward something tangible.';
    }

    if (event.registrationType === 'donation') {
      return `100% of every donation goes directly to ${event.impactTitle || 'the selected cause'}.`;
    }

    if (event.impactTitle && event.impactPercentage) {
      return `${event.impactPercentage}% of event earnings are going to ${event.impactTitle.toLowerCase()}.`;
    }

    if (event.impactTitle) {
      return `This event is backing ${event.impactTitle.toLowerCase()} with every turnout and transaction.`;
    }

    return 'Explore events where turnout, spending, and generosity all point toward something tangible.';
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
        creatorId:userId,
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

  private formatInternalOverviewEvent(event: any, now: Date) {
    let grossAmount = 0;
    let participants = 0;
    let goalAmount = 0;

    switch (event.registrationType) {
      case 'ticket':
        grossAmount = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.sold * ticket.price,
          0,
        );
        participants = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.sold,
          0,
        );
        goalAmount = event.eventTickets.reduce(
          (sum: number, ticket: any) => sum + ticket.quantity * ticket.price,
          0,
        );
        break;
      case 'donation':
        grossAmount =
          event.donations.reduce(
            (sum: number, donation: any) => sum + donation.amount,
            0,
          ) / 100;
        participants = event.donations.length;
        goalAmount = event.donationTarget || 0;
        break;
      case 'registration':
        participants = event.Registration.length;
        grossAmount = participants * (event.registrationFee || 0);
        goalAmount =
          (event.registrationAttendees || 0) * (event.registrationFee || 0);
        break;
      default:
        break;
    }

    const progress =
      goalAmount > 0 ? Math.min(Math.round((grossAmount / goalAmount) * 100), 100) : 0;
    const status =
      event.startDate <= now && event.endDate >= now ? 'LIVE' : 'UPCOMING';

    return {
      id: event.id,
      title: event.title,
      registrationType: event.registrationType,
      location: event.location || null,
      startDate: event.startDate,
      endDate: event.endDate,
      status,
      participants,
      grossAmount,
      goalAmount,
      progress,
      creator: {
        id: event.creator.id,
        username: event.creator.username,
        fullName: event.creator.fullName,
        email: event.creator.email,
      },
    };
  }

  private formatInternalActivity(transaction: any) {
    return {
      id: transaction.id,
      paymentType: transaction.paymentType,
      amount: this.toCurrencyAmount(transaction.amount),
      creatorPayable: this.toCurrencyAmount(transaction.creatorPayable || 0),
      settlementStatus: transaction.settlementStatus,
      riskStatus: transaction.riskStatus,
      createdAt: transaction.createdAt,
      event: transaction.event
        ? {
            id: transaction.event.id,
            title: transaction.event.title,
            registrationType: transaction.event.registrationType,
          }
        : null,
      buyer: {
        id: transaction.user.id,
        username: transaction.user.username,
        fullName: transaction.user.fullName,
      },
      creator: transaction.creator
        ? {
            id: transaction.creator.id,
            username: transaction.creator.username,
            fullName: transaction.creator.fullName,
          }
        : null,
    };
  }

  private toCurrencyAmount(amountKobo: number) {
    return amountKobo / 100;
  }

  private assertOpsKey(opsKey?: string) {
    const internalOpsKey = process.env.INTERNAL_OPS_KEY;

    if (!internalOpsKey || opsKey !== internalOpsKey) {
      throw new UnauthorizedException('Invalid ops key');
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { NotificationService } from '../notification/notification.service';

export enum FeedType {
  // Ticket related
  TICKET_PURCHASE = 'TICKET_PURCHASE',
  TICKET_ALMOST_SOLD_OUT = 'TICKET_ALMOST_SOLD_OUT',
  TICKET_SOLD_OUT = 'TICKET_SOLD_OUT',
  TICKET_PROGRESS_MILESTONE = 'TICKET_PROGRESS_MILESTONE',

  // Registration related
  REGISTRATION_COMPLETE = 'REGISTRATION_COMPLETE',
  REGISTRATION_ALMOST_FULL = 'REGISTRATION_ALMOST_FULL',
  REGISTRATION_FULL = 'REGISTRATION_FULL',
  REGISTRATION_PROGRESS_MILESTONE = 'REGISTRATION_PROGRESS_MILESTONE',

  // Donation related
  DONATION_MADE = 'DONATION_MADE',
  DONATION_50_PERCENT = 'DONATION_50_PERCENT',
  DONATION_75_PERCENT = 'DONATION_75_PERCENT',
  DONATION_90_PERCENT = 'DONATION_90_PERCENT',
  DONATION_95_PERCENT = 'DONATION_95_PERCENT',
  DONATION_100_PERCENT = 'DONATION_100_PERCENT',
  DONATION_PROGRESS_MILESTONE = 'DONATION_PROGRESS_MILESTONE',

  // Frenzy types
  DONATION_FRENZY = 'DONATION_FRENZY',
  TICKET_FRENZY = 'TICKET_FRENZY',
  REGISTRATION_FRENZY = 'REGISTRATION_FRENZY',
  CURRENT_FRENZY = 'CURRENT_FRENZY',

  // Event related
  EVENT_CREATED = 'EVENT_CREATED',
  EVENT_TICKET_PINNED = 'EVENT_TICKET_PINNED',
  EVENT_REGISTRATION_PINNED = 'EVENT_REGISTRATION_PINNED',
}

export enum FeedActionType {
  BUY_TICKET = 'BUY_TICKET',
  REGISTER = 'REGISTER',
  DONATE = 'DONATE',
  VIEW_TICKETS = 'VIEW_TICKETS',
  VIEW_REGISTRATION = 'VIEW_REGISTRATION',
  VIEW_DONATIONS = 'VIEW_DONATIONS',
  SHARE = 'SHARE',
}

export enum ProgressMilestone {
  GOOD_START = 'GOOD_START',
  POPULAR = 'POPULAR',
  VERY_POPULAR = 'VERY_POPULAR',
  SOLD_OUT = 'SOLD_OUT',
}

interface FeedAction {
  type: FeedActionType;
  label: string;
  url: string;
  metadata?: Record<string, any>;
}

interface FrenzyData {
  type: 'DONATION' | 'TICKET' | 'REGISTRATION';
  count: number;
  timeframe: string;
  startTime: Date;
  intensity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface FeedWithRelations {
  id: string;
  eventId: string;
  type: string;
  title: string;
  content?: string | null;
  userId?: string | null;
  metadata: any;
  actions: any;
  isPinned: boolean;
  pinOrder: number;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: string;
    username: string | null;
    profilePicUrlTN: string | null;
  } | null;
  event: {
    id: string;
    title: string | null;
    imageUrl: string | null;
  };
  isPinnedForUser?: boolean;
}

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private readonly personalPinnedTypes = new Set<FeedType>([
    FeedType.TICKET_PURCHASE,
    FeedType.REGISTRATION_COMPLETE,
    FeedType.DONATION_MADE,
  ]);

  private readonly progressThresholds = {
    TICKET: [10, 50, 100],
    REGISTRATION: [10, 50, 100],
  };

  private readonly donationThresholds = [0.5, 0.75, 0.9, 0.95, 1];

  private readonly frenzyThresholds: {
    count: number;
    timeframe: number;
    intensity: 'HIGH' | 'MEDIUM' | 'LOW';
  }[] = [
    { count: 10, timeframe: 60, intensity: 'HIGH' },
    { count: 20, timeframe: 300, intensity: 'MEDIUM' },
    { count: 50, timeframe: 1800, intensity: 'LOW' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly pubsubService: RedisPubSubService,
    private notificationsService: NotificationService,
  ) {}

  // ==================== CORE METHODS ====================

  async createFeed(data: {
    eventId: string;
    type: FeedType;
    title: string;
    content?: string;
    userId?: string;
    metadata?: Record<string, any>;
    actions?: FeedAction[];
    isPinned?: boolean;
    pinOrder?: number;
  }) {
    const feed = await this.prisma.feed.create({
      data: {
        eventId: data.eventId,
        type: data.type,
        title: data.title,
        content: data.content,
        userId: data.userId,
        metadata: data.metadata || {},
        actions: (data.actions || []) as any,
        isPinned: data.isPinned || false,
        pinOrder: data.pinOrder || (data.isPinned ? 4 : 0),
      },
      include: {
        user: data.userId
          ? {
              select: {
                id: true,
                username: true,
                profilePicUrlTN: true,
              },
            }
          : undefined,
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
          },
        },
      },
    });

    await this.pubsubService.publishFeed('feed:new', data.eventId, feed);

    this.logger.log(`Feed created: ${feed.type} for event ${data.eventId}`);
    return feed;
  }

  private async updateOrCreatePinnedFeed(data: {
    eventId: string;
    type: FeedType;
    title: string;
    content?: string;
    metadata: Record<string, any>;
    actions?: FeedAction[];
    replacePrevious?: boolean;
    pinOrder?: number;
  }) {
    if (data.replacePrevious) {
      await this.prisma.feed.updateMany({
        where: {
          eventId: data.eventId,
          type: data.type,
          isPinned: true,
        },
        data: { isPinned: false },
      });
    }

    return this.createFeed({
      ...data,
      isPinned: true,
      pinOrder: data.pinOrder || 2,
    });
  }

  async getFeedsWithCursor(
    eventId: string,
    limit: number,
    cursor?: string,
    userId?: string,
  ): Promise<FeedWithRelations[]> {
    const includePinnedFeeds = !cursor;
    const pinnedFeeds = includePinnedFeeds
      ? await this.prisma.feed.findMany({
          where: {
            eventId,
            isPinned: true,
            type: {
              notIn: [
                FeedType.TICKET_PURCHASE,
                FeedType.REGISTRATION_COMPLETE,
                FeedType.DONATION_MADE,
              ],
            },
            isHidden: userId
              ? {
                  none: { userId },
                }
              : undefined,
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profilePicUrlTN: true,
              },
            },
            event: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
              },
            },
          },
        })
      : [];

    // Sort pinned feeds
    const sortedPinnedFeeds = pinnedFeeds.sort((a, b) => {
      const orderA = this.calculatePinOrder(a);
      const orderB = this.calculatePinOrder(b);
      return orderA - orderB;
    });

    // Get regular feeds
    const regularLimit = includePinnedFeeds
      ? Math.max(0, limit - sortedPinnedFeeds.length)
      : limit;
    const cursorCondition = cursor ? { id: cursor } : undefined;

    const regularFeeds =
      regularLimit > 0
        ? await this.prisma.feed.findMany({
            where: {
              eventId,
              OR: [
                { isPinned: false },
                {
                  isPinned: true,
                  type: {
                    in: [
                      FeedType.TICKET_PURCHASE,
                      FeedType.REGISTRATION_COMPLETE,
                      FeedType.DONATION_MADE,
                    ],
                  },
                },
              ],
              isHidden: userId
                ? {
                    none: { userId },
                  }
                : undefined,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: regularLimit,
            ...(cursorCondition && {
              cursor: cursorCondition,
              skip: 1,
            }),
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profilePicUrlTN: true,
                },
              },
              event: {
                select: {
                  id: true,
                  title: true,
                  imageUrl: true,
                },
              },
            },
          })
        : [];

    // Combine feeds
    const allFeeds = [...sortedPinnedFeeds, ...regularFeeds];

    // Mark user's own feeds
    if (userId) {
      return allFeeds.map((feed) => ({
        ...feed,
        isPinned: this.isGloballyPinnedFeed(feed),
        isPinnedForUser: feed.userId === userId,
        metadata: feed.metadata,
        actions: feed.actions,
      }));
    }

    return allFeeds.map((feed) => ({
      ...feed,
      isPinned: this.isGloballyPinnedFeed(feed),
      metadata: feed.metadata,
      actions: feed.actions,
    }));
  }

  private isGloballyPinnedFeed(feed: FeedWithRelations): boolean {
    if (!feed.isPinned) return false;
    return !this.personalPinnedTypes.has(feed.type as FeedType);
  }

  private calculatePinOrder(feed: any): number {
    if (feed.type === FeedType.CURRENT_FRENZY) return 0;
    if (
      feed.type === FeedType.TICKET_SOLD_OUT ||
      feed.type === FeedType.REGISTRATION_FULL ||
      feed.type === FeedType.DONATION_100_PERCENT
    )
      return 1;
    if (
      feed.type.includes('PROGRESS_MILESTONE') ||
      feed.type === FeedType.DONATION_50_PERCENT ||
      feed.type === FeedType.DONATION_75_PERCENT ||
      feed.type === FeedType.DONATION_90_PERCENT ||
      feed.type === FeedType.DONATION_95_PERCENT
    )
      return 2;
    if (feed.userId) return 3;
    return feed.pinOrder || 4;
  }

  async hideFeed(feedId: string, userId: string) {
    await this.prisma.hiddenFeed.upsert({
      where: {
        userId_feedId: {
          userId,
          feedId,
        },
      },
      create: {
        userId,
        feedId,
      },
      update: {},
    });

    return { success: true, feedId };
  }

  // ==================== HELPER METHODS ====================

  private async getEventTicketsSold(eventId: string): Promise<number> {
    const eventTickets = await this.prisma.eventTicket.findMany({
      where: { eventId },
      select: { sold: true },
    });
    return eventTickets.reduce((total, ticket) => total + ticket.sold, 0);
  }

  private async getEventTotalTickets(eventId: string): Promise<number | null> {
    const eventTickets = await this.prisma.eventTicket.findMany({
      where: { eventId, isVisible: true },
      select: { quantity: true },
    });
    if (eventTickets.length === 0) return null;
    return eventTickets.reduce((total, ticket) => total + ticket.quantity, 0);
  }

  private async getEventRegistrationsCount(eventId: string): Promise<number> {
    return this.prisma.registration.count({
      where: {
        eventId,
        status: 'active',
      },
    });
  }

  private async getEventRegistrationLimit(
    eventId: string,
  ): Promise<number | null> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { registrationAttendees: true },
    });
    return event?.registrationAttendees || null;
  }

  private async getEventTotalDonations(eventId: string): Promise<number> {
    const result = await this.prisma.donation.aggregate({
      where: {
        eventId,
        status: 'active',
      },
      _sum: { amount: true },
    });
    return result._sum.amount || 0;
  }

  private async getEventDonationTarget(
    eventId: string,
  ): Promise<number | null> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { donationTarget: true },
    });
    return event?.donationTarget || null;
  }

  private getActionsForMilestone(
    itemType: 'TICKET' | 'REGISTRATION' | 'DONATION',
    eventId: string,
    milestone: ProgressMilestone,
  ): FeedAction[] {
    const actions: FeedAction[] = [];

    if (milestone !== ProgressMilestone.SOLD_OUT) {
      actions.push({
        type:
          itemType === 'DONATION'
            ? FeedActionType.DONATE
            : itemType === 'TICKET'
              ? FeedActionType.BUY_TICKET
              : FeedActionType.REGISTER,
        label:
          itemType === 'DONATION'
            ? 'Contribute Now'
            : `Get ${itemType === 'TICKET' ? 'Tickets' : 'Registered'}`,
        url: `/events/${eventId}/${itemType.toLowerCase()}s`,
      });
    }

    actions.push({
      type: FeedActionType.SHARE,
      label: 'Share Milestone',
      url: `/events/${eventId}/share?milestone=${milestone}`,
      metadata: { milestone },
    });

    return actions;
  }

  private formatTimeframe(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    return `${Math.floor(seconds / 3600)} hours`;
  }

  // ==================== FEED GENERATION METHODS ====================

  async generateTicketPurchaseFeed(
    eventId: string,
    userId: string,
    ticketId: string,
    eventTicketId: string,
  ) {
    await this.trackActivityForFrenzy(eventId, 'TICKET');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        creatorId: true,
      },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found for ticket purchase feed`);
      return null;
    }

    const eventTicket = await this.prisma.eventTicket.findUnique({
      where: { id: eventTicketId },
      select: { type: true, price: true },
    });

    const ticketsSold = await this.getEventTicketsSold(eventId);
    const totalTickets = await this.getEventTotalTickets(eventId);

    // Check for almost sold out
    if (totalTickets && ticketsSold >= totalTickets * 0.9) {
      await this.createFeed({
        eventId,
        type: FeedType.TICKET_ALMOST_SOLD_OUT,
        title: 'Almost Sold Out!',
        content: `${event.title} tickets are 90% sold out`,
        metadata: {
          ticketsSold,
          totalTickets,
          percentage: 0.9,
        },
        actions: [
          {
            type: FeedActionType.BUY_TICKET,
            label: 'Get Last Tickets',
            url: `/events/${eventId}/tickets`,
          },
        ],
        isPinned: true,
        pinOrder: 2,
      });
    }

    // Generate progress milestone
    await this.generateProgressMilestoneFeed(
      eventId,
      'TICKET',
      ticketsSold,
      totalTickets,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
      },
    });

    const feedContent = eventTicket
      ? `${user?.username || 'Someone'} bought a ${eventTicket.type} ticket for ${event.title}`
      : `${user?.username || 'Someone'} bought a ticket for ${event.title}`;

    return this.createFeed({
      eventId,
      type: FeedType.TICKET_PURCHASE,
      userId,
      title: 'Ticket Purchased',
      content: feedContent,
      metadata: {
        ticketId,
        eventTicketId,
        eventTitle: event.title,
        ticketType: eventTicket?.type,
        ticketPrice: eventTicket?.price,
        isCreator: userId === event.creatorId,
      },
      actions: [
        {
          type: FeedActionType.BUY_TICKET,
          label: 'Get Tickets',
          url: `/events/${eventId}/tickets`,
        },
      ],
      isPinned: false,
      pinOrder: 3,
    });
  }

  async generateDonationFeed(
    eventId: string,
    donationId: string,
    amount: number,
    isAnonymous: boolean = false,
    userId?: string,
  ) {
    await this.trackActivityForFrenzy(eventId, 'DONATION');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        creatorId: true,
      },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found for donation feed`);
      return null;
    }

    const totalDonations = await this.getEventTotalDonations(eventId);
    const donationTarget = await this.getEventDonationTarget(eventId);

    if (donationTarget) {
      await this.generateProgressMilestoneFeed(
        eventId,
        'DONATION',
        totalDonations,
        donationTarget,
      );
    }

    let user: { username: string | null } | null = null;
    if (userId && !isAnonymous) {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          username: true,
        },
      });
    }

    const amountInNaira = amount;
    const content = isAnonymous
      ? `An anonymous donor contributed ₦${amountInNaira.toLocaleString()} to ${event.title}`
      : `${user?.username || 'Someone'} donated ₦${amountInNaira.toLocaleString()} to ${event.title}`;

    return this.createFeed({
      eventId,
      type: FeedType.DONATION_MADE,
      userId: isAnonymous ? undefined : userId,
      title: 'New Donation',
      content,
      metadata: {
        donationId,
        amount,
        amountInNaira,
        isAnonymous,
        percentage: donationTarget ? totalDonations / donationTarget : 0,
        isCreator: userId === event.creatorId,
      },
      actions: [
        {
          type: FeedActionType.DONATE,
          label: 'Support Now',
          url: `/events/${eventId}/donate`,
        },
      ],
      isPinned: false,
      pinOrder: 3,
    });
  }

  async generateRegistrationFeed(
    eventId: string,
    userId: string,
    registrationId: string,
  ) {
    await this.trackActivityForFrenzy(eventId, 'REGISTRATION');

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        creatorId: true,
        registrationFee: true,
      },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found for registration feed`);
      return null;
    }

    const registrationsCount = await this.getEventRegistrationsCount(eventId);
    const registrationLimit = await this.getEventRegistrationLimit(eventId);

    await this.generateProgressMilestoneFeed(
      eventId,
      'REGISTRATION',
      registrationsCount,
      registrationLimit,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
      },
    });

    const registrationType = event.registrationFee
      ? event.registrationFee > 0
        ? 'paid'
        : 'free'
      : 'free';

    const feedContent =
      registrationType === 'paid'
        ? `${user?.username || 'Someone'} registered for ${event.title} (₦${(event.registrationFee! / 100).toLocaleString()})`
        : `${user?.username || 'Someone'} registered for ${event.title}`;

    return this.createFeed({
      eventId,
      type: FeedType.REGISTRATION_COMPLETE,
      userId,
      title: 'Registration Complete',
      content: feedContent,
      metadata: {
        registrationId,
        eventTitle: event.title,
        registrationFee: event.registrationFee,
        registrationType,
        isCreator: userId === event.creatorId,
      },
      actions: [
        {
          type: FeedActionType.REGISTER,
          label: 'Register Now',
          url: `/events/${eventId}/register`,
        },
      ],
      isPinned: false,
      pinOrder: 3,
    });
  }

  async generateEventCreatedFeed(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        title: true,
        description: true,
        startDate: true,
        location: true,
      },
    });

    if (!event) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        username: true,
      },
    });

    const locationText = event.location ? ` in ${event.location}` : '';
    const dateText = event.startDate
      ? ` on ${event.startDate.toLocaleDateString()}`
      : '';

    return this.createFeed({
      eventId,
      type: FeedType.EVENT_CREATED,
      userId,
      title: 'New Event Created',
      content: `${user?.username || 'Someone'} created "${event.title}"${locationText}${dateText}`,
      metadata: {
        eventTitle: event.title,
        location: event.location,
        startDate: event.startDate,
        isCreator: true,
      },
      actions: [
        {
          type: FeedActionType.SHARE,
          label: 'Share Event',
          url: `/events/${eventId}`,
        },
      ],
      isPinned: true,
      pinOrder: 4,
    });
  }

  async generateProgressMilestoneFeed(
    eventId: string,
    itemType: 'TICKET' | 'REGISTRATION' | 'DONATION',
    currentCount: number,
    totalAvailable?: number | null,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found for progress milestone`);
      return null;
    }

    // Check if we've already created milestones for this event
    const milestoneKey = `milestones:${eventId}:${itemType}`;
    const createdMilestones = await this.redisService.client.get(milestoneKey);
    const parsedMilestones: string[] = createdMilestones
      ? JSON.parse(createdMilestones)
      : [];

    let feedType: FeedType;
    let milestone: ProgressMilestone | null = null;
    let percentage: number | null = null;
    let shouldPin = false;
    let milestoneValue: number = 0;
    let milestoneIdentifier: string | null = null;
    let shouldNotify = false;

    if (itemType === 'DONATION' && totalAvailable) {
      percentage = totalAvailable > 0 ? currentCount / totalAvailable : 0;
      feedType = FeedType.DONATION_PROGRESS_MILESTONE;

      // Define donation milestones
      const donationMilestones = [
        {
          threshold: 1,
          feedType: FeedType.DONATION_100_PERCENT,
          milestone: ProgressMilestone.SOLD_OUT,
          id: '100%',
        },
        {
          threshold: 0.95,
          feedType: FeedType.DONATION_95_PERCENT,
          milestone: ProgressMilestone.VERY_POPULAR,
          id: '95%',
        },
        {
          threshold: 0.9,
          feedType: FeedType.DONATION_90_PERCENT,
          milestone: ProgressMilestone.VERY_POPULAR,
          id: '90%',
        },
        {
          threshold: 0.75,
          feedType: FeedType.DONATION_75_PERCENT,
          milestone: ProgressMilestone.POPULAR,
          id: '75%',
        },
        {
          threshold: 0.5,
          feedType: FeedType.DONATION_50_PERCENT,
          milestone: ProgressMilestone.POPULAR,
          id: '50%',
        },
        {
          threshold: 0.1,
          feedType: FeedType.DONATION_PROGRESS_MILESTONE,
          milestone: ProgressMilestone.GOOD_START,
          id: '10%',
        },
      ];

      const reachedDonationMilestones = donationMilestones.filter(
        (milestoneDef) => percentage && percentage >= milestoneDef.threshold,
      );
      const nextDonationMilestone = reachedDonationMilestones.find(
        (milestoneDef) => !parsedMilestones.includes(milestoneDef.id),
      );

      if (nextDonationMilestone) {
        milestoneIdentifier = nextDonationMilestone.id;
        feedType = nextDonationMilestone.feedType;
        milestone = nextDonationMilestone.milestone;
        milestoneValue = nextDonationMilestone.threshold;
        shouldPin = true;
        shouldNotify = true;

        // Mark all reached milestones as created so lower thresholds
        // are not emitted later after a higher one has already fired.
        const mergedMilestones = Array.from(
          new Set([
            ...parsedMilestones,
            ...reachedDonationMilestones.map((m) => m.id),
          ]),
        );

        await this.redisService.client.set(
          milestoneKey,
          JSON.stringify(mergedMilestones),
          'EX',
          60 * 60 * 24 * 7, // Keep for 1 week
        );
      }

      if (!milestoneIdentifier || milestone === null || !milestoneValue)
        return null;
    } else if (itemType === 'TICKET' || itemType === 'REGISTRATION') {
      feedType =
        itemType === 'TICKET'
          ? FeedType.TICKET_PROGRESS_MILESTONE
          : FeedType.REGISTRATION_PROGRESS_MILESTONE;

      const thresholds = this.progressThresholds[itemType];

      const sortedThresholds = [...thresholds].sort((a, b) => b - a);
      const reachedThresholds = sortedThresholds.filter(
        (threshold) => currentCount >= threshold,
      );
      const nextThreshold = reachedThresholds.find(
        (threshold) => !parsedMilestones.includes(threshold.toString()),
      );

      if (nextThreshold) {
        milestoneValue = nextThreshold;
        const isSoldOut = Boolean(
          totalAvailable && currentCount >= totalAvailable * 0.95,
        );

        if (isSoldOut) {
          milestone = ProgressMilestone.SOLD_OUT;
          shouldPin = true;
          feedType =
            itemType === 'TICKET'
              ? FeedType.TICKET_SOLD_OUT
              : FeedType.REGISTRATION_FULL;
          milestoneIdentifier = 'SOLD_OUT';
        } else {
          milestoneIdentifier = nextThreshold.toString();

          if (milestoneValue >= 100) {
            milestone = ProgressMilestone.VERY_POPULAR;
            shouldPin = true;
          } else if (milestoneValue >= 50) {
            milestone = ProgressMilestone.VERY_POPULAR;
            shouldPin = true;
          } else if (milestoneValue >= 10) {
            milestone = ProgressMilestone.POPULAR;
            shouldPin = true;
          }
        }

        shouldNotify = true;

        const mergedMilestones = Array.from(
          new Set([
            ...parsedMilestones,
            ...reachedThresholds.map((threshold) => threshold.toString()),
            ...(isSoldOut ? ['SOLD_OUT'] : []),
          ]),
        );

        await this.redisService.client.set(
          milestoneKey,
          JSON.stringify(mergedMilestones),
          'EX',
          60 * 60 * 24 * 7, // Keep for 1 week
        );
      }

      if (!milestoneIdentifier || milestone === null || !milestoneValue)
        return null;
    } else {
      return null;
    }

    let title = '';
    let content = '';

    if (itemType === 'DONATION') {
      const percentText = Math.round(milestoneValue * 100);
      const amountInNaira = totalAvailable ? totalAvailable.toLocaleString() : '0';
      title = `${percentText}% Funded!`;
      content = `${event.title} has raised ₦${currentCount.toLocaleString()} of ₦${amountInNaira} goal`;
    } else if (itemType === 'TICKET') {
      title = `${currentCount} Tickets Sold!`;
      content = `${event.title} has sold ${currentCount} tickets`;

      if (totalAvailable) {
        const percent = Math.round((currentCount / totalAvailable) * 100);
        content += ` (${percent}% sold)`;
      }
    } else {
      title = `${currentCount} Registrations!`;
      content = `${event.title} has ${currentCount} registrations`;

      if (totalAvailable) {
        const percent = Math.round((currentCount / totalAvailable) * 100);
        content += ` (${percent}% full)`;
      }
    }

    const feedData = {
      eventId,
      type: feedType,
      title,
      content,
      metadata: {
        itemType,
        currentCount,
        totalAvailable,
        percentage,
        milestone,
        milestoneValue,
        amountInNaira: itemType === 'DONATION' ? currentCount : undefined,
        targetInNaira:
          itemType === 'DONATION' && totalAvailable
            ? totalAvailable
            : undefined,
      },
      actions: this.getActionsForMilestone(itemType, eventId, milestone),
    };

    let feed;
    if (shouldPin) {
      const replacePrevious =
        itemType === 'DONATION' &&
        [
          FeedType.DONATION_50_PERCENT,
          FeedType.DONATION_75_PERCENT,
          FeedType.DONATION_90_PERCENT,
          FeedType.DONATION_95_PERCENT,
          FeedType.DONATION_100_PERCENT,
        ].includes(feedType);

      feed = await this.updateOrCreatePinnedFeed({
        ...feedData,
        replacePrevious,
        pinOrder: milestone === ProgressMilestone.SOLD_OUT ? 1 : 2,
      });
    } else {
      feed = await this.createFeed(feedData);
    }

    // Send notification for milestone feeds
    if (shouldNotify && feed) {
      await this.sendMilestoneNotification(
        eventId,
        feedType,
        title,
        content,
        feedData.metadata,
      );
    }

    return feed;
  }

  // async generateProgressMilestoneFeed(
  //   eventId: string,
  //   itemType: 'TICKET' | 'REGISTRATION' | 'DONATION',
  //   currentCount: number,
  //   totalAvailable?: number | null,
  // ) {
  //   const event = await this.prisma.event.findUnique({
  //     where: { id: eventId },
  //     select: {
  //       title: true,
  //     },
  //   });

  //   if (!event) {
  //     this.logger.warn(`Event ${eventId} not found for progress milestone`);
  //     return null;
  //   }

  //   let feedType: FeedType;
  //   let milestone: ProgressMilestone;
  //   let percentage: number | null = null;
  //   let shouldPin = false;
  //   let milestoneValue: number;

  //   if (itemType === 'DONATION' && totalAvailable) {
  //     percentage = totalAvailable > 0 ? currentCount / totalAvailable : 0;
  //     feedType = FeedType.DONATION_PROGRESS_MILESTONE;

  //     if (percentage >= 1) {
  //       milestone = ProgressMilestone.SOLD_OUT;
  //       shouldPin = true;
  //       feedType = FeedType.DONATION_100_PERCENT;
  //     } else if (percentage >= 0.95) {
  //       milestone = ProgressMilestone.VERY_POPULAR;
  //       shouldPin = true;
  //       feedType = FeedType.DONATION_95_PERCENT;
  //     } else if (percentage >= 0.9) {
  //       milestone = ProgressMilestone.VERY_POPULAR;
  //       shouldPin = true;
  //       feedType = FeedType.DONATION_90_PERCENT;
  //     } else if (percentage >= 0.75) {
  //       milestone = ProgressMilestone.POPULAR;
  //       shouldPin = true;
  //       feedType = FeedType.DONATION_75_PERCENT;
  //     } else if (percentage >= 0.5) {
  //       milestone = ProgressMilestone.POPULAR;
  //       shouldPin = true;
  //       feedType = FeedType.DONATION_50_PERCENT;
  //     } else if (percentage >= 0.1) {
  //       milestone = ProgressMilestone.GOOD_START;
  //       shouldPin = true;
  //     } else {
  //       return null;
  //     }

  //     milestoneValue = percentage;
  //   } else if (itemType === 'TICKET' || itemType === 'REGISTRATION') {
  //     feedType =
  //       itemType === 'TICKET'
  //         ? FeedType.TICKET_PROGRESS_MILESTONE
  //         : FeedType.REGISTRATION_PROGRESS_MILESTONE;

  //     const thresholds = this.progressThresholds[itemType];
  //     const reachedThresholds = thresholds.filter((t) => currentCount >= t);

  //     if (reachedThresholds.length === 0) return null;

  //     milestoneValue = Math.max(...reachedThresholds);

  //     if (totalAvailable && currentCount >= totalAvailable * 0.95) {
  //       milestone = ProgressMilestone.SOLD_OUT;
  //       shouldPin = true;
  //       feedType =
  //         itemType === 'TICKET'
  //           ? FeedType.TICKET_SOLD_OUT
  //           : FeedType.REGISTRATION_FULL;
  //     } else if (milestoneValue >= 100) {
  //       milestone = ProgressMilestone.VERY_POPULAR;
  //       shouldPin = true;
  //     } else if (milestoneValue >= 50) {
  //       milestone = ProgressMilestone.VERY_POPULAR;
  //       shouldPin = true;
  //     } else if (milestoneValue >= 10) {
  //       milestone = ProgressMilestone.POPULAR;
  //       shouldPin = true;
  //     } else {
  //       milestone = ProgressMilestone.GOOD_START;
  //       shouldPin = true;
  //     }
  //   } else {
  //     return null;
  //   }

  //   let title = '';
  //   let content = '';

  //   if (itemType === 'DONATION') {
  //     const percentText = Math.round(milestoneValue * 100);
  //     const amountInNaira = totalAvailable
  //       ? (totalAvailable / 100).toLocaleString()
  //       : '0';
  //     title = `${percentText}% Funded!`;
  //     content = `${event.title} has raised ₦${(currentCount / 100).toLocaleString()} of ₦${amountInNaira} goal`;
  //   } else if (itemType === 'TICKET') {
  //     title = `${currentCount} Tickets Sold!`;
  //     content = `${event.title} has sold ${currentCount} tickets`;

  //     if (totalAvailable) {
  //       const percent = Math.round((currentCount / totalAvailable) * 100);
  //       content += ` (${percent}% sold)`;
  //     }
  //   } else {
  //     title = `${currentCount} Registrations!`;
  //     content = `${event.title} has ${currentCount} registrations`;

  //     if (totalAvailable) {
  //       const percent = Math.round((currentCount / totalAvailable) * 100);
  //       content += ` (${percent}% full)`;
  //     }
  //   }

  //   const feedData = {
  //     eventId,
  //     type: feedType,
  //     title,
  //     content,
  //     metadata: {
  //       itemType,
  //       currentCount,
  //       totalAvailable,
  //       percentage,
  //       milestone,
  //       milestoneValue,
  //       amountInNaira: itemType === 'DONATION' ? currentCount / 100 : undefined,
  //       targetInNaira:
  //         itemType === 'DONATION' && totalAvailable
  //           ? totalAvailable / 100
  //           : undefined,
  //     },
  //     actions: this.getActionsForMilestone(itemType, eventId, milestone),
  //   };

  //   if (shouldPin) {
  //     const replacePrevious =
  //       itemType === 'DONATION' &&
  //       [
  //         FeedType.DONATION_50_PERCENT,
  //         FeedType.DONATION_75_PERCENT,
  //         FeedType.DONATION_90_PERCENT,
  //         FeedType.DONATION_95_PERCENT,
  //         FeedType.DONATION_100_PERCENT,
  //       ].includes(feedType);

  //     return this.updateOrCreatePinnedFeed({
  //       ...feedData,
  //       replacePrevious,
  //       pinOrder: milestone === ProgressMilestone.SOLD_OUT ? 1 : 2,
  //     });
  //   }

  //   return this.createFeed(feedData);
  // }

  async generateOrUpdateFrenzyFeed(eventId: string, frenzyData: FrenzyData) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true },
    });

    if (!event) {
      this.logger.warn(`Event ${eventId} not found for frenzy feed`);
      return null;
    }

    const title = `${frenzyData.intensity} ${frenzyData.type} Frenzy!`;
    const content = `${frenzyData.count} ${frenzyData.type.toLowerCase()}s in the last ${frenzyData.timeframe}`;

    const feed = this.updateOrCreatePinnedFeed({
      eventId,
      type: FeedType.CURRENT_FRENZY,
      title,
      content,
      metadata: {
        ...frenzyData,
        updatedAt: new Date(),
      },
      actions: [
        {
          type:
            frenzyData.type === 'DONATION'
              ? FeedActionType.DONATE
              : frenzyData.type === 'TICKET'
                ? FeedActionType.BUY_TICKET
                : FeedActionType.REGISTER,
          label: `Join ${frenzyData.type} Frenzy`,
          url: `/events/${eventId}/${frenzyData.type.toLowerCase()}s`,
        },
      ],
      replacePrevious: true,
      pinOrder: 0,
    });

    // Send notification for frenzy feeds (only HIGH intensity)
    if (['HIGH', 'MEDIUM'].includes(frenzyData.intensity)) {
      await this.sendFrenzyNotification(eventId, frenzyData, title, content);
    }

    return feed;
  }

  async trackActivityForFrenzy(
    eventId: string,
    activityType: 'DONATION' | 'TICKET' | 'REGISTRATION',
  ) {
    const now = Date.now();
    const thresholdSnapshots: {
      threshold: (typeof this.frenzyThresholds)[number];
      key: string;
      activityList: number[];
      triggered: boolean;
    }[] = [];

    for (const threshold of this.frenzyThresholds) {
      const key = `frenzy:${eventId}:${activityType}:${threshold.timeframe}`;
      const activities = await this.redisService.client.get(key);
      let activityList: number[] = activities ? JSON.parse(activities) : [];

      activityList = activityList.filter(
        (timestamp) => now - timestamp < threshold.timeframe * 1000,
      );
      activityList.push(now);

      thresholdSnapshots.push({
        threshold,
        key,
        activityList,
        triggered: activityList.length >= threshold.count,
      });
    }

    const intensityRank: Record<'HIGH' | 'MEDIUM' | 'LOW', number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    const strongestTriggered = thresholdSnapshots
      .filter((snapshot) => snapshot.triggered)
      .sort(
        (a, b) =>
          intensityRank[b.threshold.intensity] - intensityRank[a.threshold.intensity],
      )[0];

    if (strongestTriggered) {
      await this.generateOrUpdateFrenzyFeed(eventId, {
        type: activityType,
        count: strongestTriggered.activityList.length,
        timeframe: this.formatTimeframe(strongestTriggered.threshold.timeframe),
        startTime: new Date(now - strongestTriggered.threshold.timeframe * 1000),
        intensity: strongestTriggered.threshold.intensity,
      });
    }

    for (const snapshot of thresholdSnapshots) {
      const nextList = snapshot.triggered ? [] : snapshot.activityList;
      await this.redisService.client.set(
        snapshot.key,
        JSON.stringify(nextList),
        'EX',
        snapshot.threshold.timeframe * 2,
      );
    }
  }

  // ==================== USER METHODS ====================

  async getUserPinnedFeeds(userId: string) {
    const userTickets = await this.prisma.ticket.findMany({
      where: {
        userId,
        status: 'active',
      },
      include: {
        eventTicket: {
          include: {
            event: {
              select: {
                id: true,
                title: true,
                imageUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const userRegistrations = await this.prisma.registration.findMany({
      where: {
        userId,
        status: 'active',
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const userDonations = await this.prisma.donation.findMany({
      where: {
        userId,
        status: 'active',
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const pinnedFeeds = [
      ...userTickets.map((ticket) => ({
        id: `ticket-${ticket.id}`,
        type: FeedType.EVENT_TICKET_PINNED,
        title: 'Your Ticket',
        content: `You have a ${ticket.eventTicket.type} ticket for ${ticket.eventTicket.event.title}`,
        eventId: ticket.eventTicket.eventId,
        userId,
        metadata: {
          ticketId: ticket.id,
          ticketType: ticket.eventTicket.type,
          ticketPrice: ticket.eventTicket.price,
          eventTitle: ticket.eventTicket.event.title,
        },
        actions: [
          {
            type: FeedActionType.VIEW_TICKETS,
            label: 'View Ticket',
            url: `/events/${ticket.eventTicket.event.id}/tickets`,
          },
        ],
        createdAt: ticket.createdAt,
        isPinned: true,
        isPinnedForUser: true,
        event: ticket.eventTicket.event,
        user: null,
        pinOrder: 3,
      })),
      ...userRegistrations.map((registration) => ({
        id: `registration-${registration.id}`,
        type: FeedType.EVENT_REGISTRATION_PINNED,
        title: 'Your Registration',
        content: `You're registered for ${registration.event.title}`,
        eventId: registration.eventId,
        userId,
        metadata: {
          registrationId: registration.id,
          eventTitle: registration.event.title,
        },
        actions: [
          {
            type: FeedActionType.VIEW_REGISTRATION,
            label: 'View Registration',
            url: `/events/${registration.event.id}/registrations`,
          },
        ],
        createdAt: registration.createdAt,
        isPinned: true,
        isPinnedForUser: true,
        event: registration.event,
        user: null,
        pinOrder: 3,
      })),
      ...userDonations.map((donation) => ({
        id: `donation-${donation.id}`,
        type: FeedType.DONATION_MADE,
        title: donation.isAnonymous ? 'Anonymous Donation' : 'Your Donation',
        content: donation.isAnonymous
          ? `An anonymous donation was made to ${donation.event.title}`
          : `You donated ₦${donation.amount.toLocaleString()} to ${donation.event.title}`,
        eventId: donation.eventId,
        userId: donation.isAnonymous ? undefined : userId,
        metadata: {
          donationId: donation.id,
          isAnonymous: donation.isAnonymous,
          amount: donation.amount,
          amountInNaira: donation.amount,
          eventTitle: donation.event.title,
        },
        actions: [
          {
            type: FeedActionType.DONATE,
            label: 'Donate More',
            url: `/events/${donation.event.id}/donate`,
          },
        ],
        createdAt: donation.createdAt,
        isPinned: true,
        isPinnedForUser: !donation.isAnonymous,
        event: donation.event,
        user: donation.isAnonymous ? null : undefined,
        pinOrder: 3,
      })),
    ];

    return pinnedFeeds
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);
  }

  async getTotalUnreadCount(userId: string, eventId?: string): Promise<number> {
    // Implement based on your notification system
    // This could track feeds the user hasn't seen yet
    return 0;
  }

  // ==================== UNIFIED NOTIFICATION HELPER METHOD ====================

  private async sendEventNotification(
    eventId: string,
    notificationType: string,
    title: string,
    message: string,
    metadata?: Record<string, any>,
    imageUrl?: string,
    link?: string,
  ) {
    try {
      // Get event details
      const event = await this.prisma.event.findUnique({
        where: { id: eventId },
        select: {
          id: true,
          title: true,
          creatorId: true,
          imageUrl: true,
        },
      });

      if (!event) {
        this.logger.warn(`Event ${eventId} not found for notification`);
        return;
      }

      // Get all users who have interacted with the event
      const [ticketBuyers, registrants, donors] = await Promise.all([
        this.prisma.ticket.findMany({
          where: {
            eventTicket: { eventId },
            status: 'active',
          },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.registration.findMany({
          where: {
            eventId,
            status: 'active',
          },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.donation.findMany({
          where: {
            eventId,
            status: 'active',
            isAnonymous: false,
          },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ]);

      // Collect unique user IDs
      const userIds = new Set<string>();

      // Add event creator
      if (event.creatorId) {
        userIds.add(event.creatorId);
      }

      // Add ticket buyers
      ticketBuyers.forEach(
        (ticket) => ticket.userId && userIds.add(ticket.userId),
      );

      // Add registrants
      registrants.forEach((reg) => reg.userId && userIds.add(reg.userId));

      // Add donors
      donors.forEach(
        (donation) => donation.userId && userIds.add(donation.userId),
      );

      if (userIds.size === 0) {
        this.logger.debug(`No users to notify for event ${eventId}`);
        return;
      }

      // Prepare notification data
      const notificationData = {
        recipientIds: Array.from(userIds),
        type: notificationType,
        title: `${event.title}: ${title}`,
        message: message,
        imageUrl: imageUrl || event.imageUrl || undefined,
        link: link || `/events/${eventId}/feed`,
        data: {
          eventId,
          eventTitle: event.title,
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      };

      // Send notification
      await this.notificationsService.createNotification(notificationData);

      this.logger.log(
        `Sent ${notificationType} notification to ${userIds.size} users for event ${eventId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send notification: ${error.message}`,
        error.stack,
      );
    }
  }

  // ==================== SPECIFIC NOTIFICATION WRAPPERS ====================

  private async sendMilestoneNotification(
    eventId: string,
    feedType: FeedType,
    title: string,
    message: string,
    metadata?: Record<string, any>,
  ) {
    await this.sendEventNotification(
      eventId,
      `FEED_${feedType}`,
      title,
      message,
      {
        ...metadata,
        feedType,
        isMilestone: true,
      },
    );
  }

  private async sendFrenzyNotification(
    eventId: string,
    frenzyData: FrenzyData,
    title: string,
    message: string,
  ) {
    await this.sendEventNotification(
      eventId,
      `FEED_FRENZY_${frenzyData.type}_${frenzyData.intensity}`,
      title,
      message,
      {
        frenzyType: frenzyData.type,
        intensity: frenzyData.intensity,
        count: frenzyData.count,
        timeframe: frenzyData.timeframe,
        isFrenzy: true,
      },
    );
  }

  async getFrenzyHistory(eventId: string, limit: number = 10, cursor?: string) {
    const cursorCondition = cursor ? { id: cursor } : undefined;

    return this.prisma.feed.findMany({
      where: {
        eventId,
        OR: [
          { type: FeedType.CURRENT_FRENZY },
          { type: FeedType.TICKET_FRENZY },
          { type: FeedType.DONATION_FRENZY },
          { type: FeedType.REGISTRATION_FRENZY },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      ...(cursorCondition && {
        cursor: cursorCondition,
        skip: 1,
      }),
      include: {
        event: {
          select: { id: true, title: true, imageUrl: true },
        },
        user: {
          select: {
            id: true,
            username: true,
            profilePicUrlTN: true,
          },
        },
      },
    });
  }

  async cleanupOldFeeds(days: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.feed.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        isPinned: false,
      },
    });

    this.logger.log(`Cleaned up ${result.count} old feeds`);
    return result;
  }

  async getFeedStats(eventId: string) {
    const totalFeeds = await this.prisma.feed.count({
      where: { eventId },
    });

    const pinnedFeeds = await this.prisma.feed.count({
      where: {
        eventId,
        isPinned: true,
      },
    });

    const frenzyFeeds = await this.prisma.feed.count({
      where: {
        eventId,
        OR: [
          { type: FeedType.CURRENT_FRENZY },
          { type: FeedType.TICKET_FRENZY },
          { type: FeedType.DONATION_FRENZY },
          { type: FeedType.REGISTRATION_FRENZY },
        ],
      },
    });

    const lastActivity = await this.prisma.feed.findFirst({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, type: true },
    });

    return {
      totalFeeds,
      pinnedFeeds,
      frenzyFeeds,
      lastActivity,
    };
  }
}

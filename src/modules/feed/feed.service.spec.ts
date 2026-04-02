import { FeedService, FeedType } from './feed.service';

describe('FeedService', () => {
  const prisma = {
    event: {
      findUnique: jest.fn(),
    },
    eventTicket: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    feed: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  } as any;
  const redisService = {
    client: {
      get: jest.fn(),
      del: jest.fn(),
      set: jest.fn(),
    },
  } as any;
  const pubsubService = {
    publishFeed: jest.fn(),
  } as any;
  const notificationService = {
    createNotification: jest.fn(),
  } as any;
  const mailService = {} as any;

  let service: FeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FeedService(
      prisma,
      redisService,
      pubsubService,
      notificationService,
      mailService,
    );
    redisService.client.del.mockResolvedValue(1);
  });

  it('creates a sold-out milestone for small ticket events', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Launch Party' });
    redisService.client.get.mockResolvedValue(null);
    redisService.client.set.mockResolvedValue('OK');

    const updatePinnedSpy = jest
      .spyOn(service as any, 'updateOrCreatePinnedFeed')
      .mockResolvedValue({ id: 'feed-1' });
    jest
      .spyOn(service as any, 'sendMilestoneNotification')
      .mockResolvedValue(undefined);

    await service.generateProgressMilestoneFeed('event-1', 'TICKET', 5, 5);

    expect(updatePinnedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        type: FeedType.TICKET_SOLD_OUT,
        title: '5 Tickets Sold!',
      }),
    );
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      1,
      'milestones:event-1:TICKET:SOLD_OUT',
      '1',
      'EX',
      60 * 60 * 24 * 7,
      'NX',
    );
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      2,
      'milestones:event-1:TICKET',
      JSON.stringify(['SOLD_OUT']),
      'EX',
      60 * 60 * 24 * 7,
    );
  });

  it('stores donation milestone amounts in naira', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Fundraiser' });
    redisService.client.get.mockResolvedValue(null);
    redisService.client.set.mockResolvedValue('OK');

    const updatePinnedSpy = jest
      .spyOn(service as any, 'updateOrCreatePinnedFeed')
      .mockResolvedValue({ id: 'feed-2' });
    jest
      .spyOn(service as any, 'sendMilestoneNotification')
      .mockResolvedValue(undefined);

    await service.generateProgressMilestoneFeed(
      'event-2',
      'DONATION',
      500000,
      1000000,
    );

    expect(updatePinnedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: FeedType.DONATION_50_PERCENT,
        content: 'Fundraiser has raised ₦5,000 of ₦10,000 goal',
        metadata: expect.objectContaining({
          amountInNaira: 5000,
          targetInNaira: 10000,
        }),
      }),
    );
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      1,
      'milestones:event-2:DONATION:50%',
      '1',
      'EX',
      60 * 60 * 24 * 7,
      'NX',
    );
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      2,
      'milestones:event-2:DONATION',
      JSON.stringify(['50%']),
      'EX',
      60 * 60 * 24 * 7,
    );
  });

  it('creates a single feed for batched ticket purchases', async () => {
    prisma.event.findUnique.mockResolvedValue({
      title: 'Launch Party',
      creatorId: 'creator-1',
    });
    prisma.eventTicket.findMany.mockResolvedValue([
      { id: 'event-ticket-1', type: 'VIP', price: 5000 },
      { id: 'event-ticket-2', type: 'Regular', price: 2500 },
    ]);
    prisma.user.findUnique.mockResolvedValue({ username: 'ada' });

    jest
      .spyOn(service as any, 'trackActivityForFrenzy')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'getEventTicketsSold')
      .mockResolvedValue(15);
    jest
      .spyOn(service as any, 'getEventTotalTickets')
      .mockResolvedValue(100);
    const milestoneSpy = jest
      .spyOn(service, 'generateProgressMilestoneFeed')
      .mockResolvedValue(null);
    const createFeedSpy = jest
      .spyOn(service, 'createFeed')
      .mockResolvedValue({ id: 'feed-3' } as any);

    await service.generateTicketPurchaseBatchFeed('event-1', 'user-1', [
      {
        eventTicketId: 'event-ticket-1',
        ticketIds: ['ticket-1', 'ticket-2', 'ticket-3'],
        quantity: 3,
      },
      {
        eventTicketId: 'event-ticket-2',
        ticketIds: ['ticket-4', 'ticket-5'],
        quantity: 2,
      },
    ]);

    expect(milestoneSpy).toHaveBeenCalledTimes(1);
    expect(createFeedSpy).toHaveBeenCalledTimes(1);
    expect(createFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        type: FeedType.TICKET_PURCHASE,
        content:
          'ada bought 5 tickets for Launch Party (3 VIP tickets, 2 Regular tickets)',
        metadata: expect.objectContaining({
          quantity: 5,
          ticketIds: [
            'ticket-1',
            'ticket-2',
            'ticket-3',
            'ticket-4',
            'ticket-5',
          ],
          eventTicketIds: ['event-ticket-1', 'event-ticket-2'],
          purchases: [
            expect.objectContaining({
              eventTicketId: 'event-ticket-1',
              quantity: 3,
              ticketType: 'VIP',
              ticketPrice: 5000,
            }),
            expect.objectContaining({
              eventTicketId: 'event-ticket-2',
              quantity: 2,
              ticketType: 'Regular',
              ticketPrice: 2500,
            }),
          ],
        }),
      }),
    );
  });

  it('does not create a duplicate milestone when reservation is lost', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Launch Party' });
    redisService.client.get.mockResolvedValue(null);
    redisService.client.set.mockResolvedValue(null);

    const updatePinnedSpy = jest
      .spyOn(service as any, 'updateOrCreatePinnedFeed')
      .mockResolvedValue({ id: 'feed-4' });
    const notifySpy = jest
      .spyOn(service as any, 'sendMilestoneNotification')
      .mockResolvedValue(undefined);

    const result = await service.generateProgressMilestoneFeed(
      'event-1',
      'TICKET',
      10,
      100,
    );

    expect(result).toBeNull();
    expect(updatePinnedSpy).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
    expect(redisService.client.set).toHaveBeenCalledWith(
      'milestones:event-1:TICKET:10',
      '1',
      'EX',
      60 * 60 * 24 * 7,
      'NX',
    );
  });

  it('updates the current frenzy feed and avoids duplicate history/notifications', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Launch Party' });
    prisma.feed.findFirst.mockResolvedValue({
      id: 'current-feed-1',
      eventId: 'event-1',
      type: FeedType.CURRENT_FRENZY,
      isPinned: true,
    });
    prisma.feed.update.mockResolvedValue({
      id: 'current-feed-1',
      eventId: 'event-1',
      type: FeedType.CURRENT_FRENZY,
      title: 'HIGH TICKET Frenzy!',
      content: '12 tickets in the last 60 seconds',
    });
    redisService.client.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);

    const createFeedSpy = jest
      .spyOn(service, 'createFeed')
      .mockResolvedValue({ id: 'history-feed-1' } as any);
    const notifySpy = jest
      .spyOn(service as any, 'sendFrenzyNotification')
      .mockResolvedValue(undefined);

    const result = await service.generateOrUpdateFrenzyFeed('event-1', {
      type: 'TICKET',
      count: 12,
      timeframe: '60 seconds',
      startTime: new Date(Date.now() - 60_000),
      intensity: 'HIGH',
    });

    expect(result).toEqual(
      expect.objectContaining({
        id: 'current-feed-1',
        type: FeedType.CURRENT_FRENZY,
      }),
    );
    expect(prisma.feed.update).toHaveBeenCalledTimes(1);
    expect(createFeedSpy).not.toHaveBeenCalled();
    expect(pubsubService.publishFeed).toHaveBeenCalledWith(
      'feed:updated',
      'event-1',
      expect.objectContaining({
        id: 'current-feed-1',
      }),
    );
    expect(notifySpy).not.toHaveBeenCalled();
    expect(redisService.client.del).toHaveBeenCalledWith(
      'frenzy:event-1:current:lock',
    );
  });

  it('creates frenzy history and notification once for a new frenzy signature', async () => {
    prisma.event.findUnique.mockResolvedValue({ title: 'Launch Party' });
    prisma.feed.findFirst.mockResolvedValue(null);
    redisService.client.set
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce('OK');

    const createFeedSpy = jest
      .spyOn(service, 'createFeed')
      .mockResolvedValueOnce({
        id: 'current-feed-2',
        eventId: 'event-1',
        type: FeedType.CURRENT_FRENZY,
      } as any)
      .mockResolvedValueOnce({
        id: 'history-feed-2',
        eventId: 'event-1',
        type: FeedType.DONATION_FRENZY,
      } as any);
    const notifySpy = jest
      .spyOn(service as any, 'sendFrenzyNotification')
      .mockResolvedValue(undefined);

    await service.generateOrUpdateFrenzyFeed('event-1', {
      type: 'DONATION',
      count: 21,
      timeframe: '5 minutes',
      startTime: new Date(Date.now() - 300_000),
      intensity: 'MEDIUM',
    });

    expect(createFeedSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventId: 'event-1',
        type: FeedType.CURRENT_FRENZY,
        isPinned: true,
      }),
    );
    expect(createFeedSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventId: 'event-1',
        type: FeedType.DONATION_FRENZY,
        isPinned: false,
      }),
    );
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      1,
      'frenzy:event-1:current:lock',
      '1',
      'EX',
      10,
      'NX',
    );
    expect(redisService.client.set).toHaveBeenNthCalledWith(
      2,
      'frenzy:event-1:DONATION:MEDIUM:5 minutes',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
  });
});

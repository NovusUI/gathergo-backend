import { Test, TestingModule } from '@nestjs/testing';
import { CarpoolService } from './carpool.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageService } from '../message/message.service';
import { MessageGateway } from '../message/message.gateway';
import { NotificationService } from '../notification/notification.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';

describe('CarpoolService', () => {
  let service: CarpoolService;

  const prismaMock = {
    carpool: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    carpoolPassenger: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    event: { findUnique: jest.fn() },
    ticket: { findMany: jest.fn() },
    userFollow: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRawUnsafe: jest.fn(),
  };

  const messageServiceMock = {
    createMessage: jest.fn(),
    getConversationTray: jest.fn(),
  };

  const messageGatewayMock = {
    pushConversationTray: jest.fn(),
  };

  const notificationServiceMock = {
    createNotification: jest.fn(),
  };

  const pubsubServiceMock = {
    publishCarpoolUpdate: jest.fn(),
  };

  const baseCarpool = {
    id: 'carpool-1',
    driverId: 'driver-1',
    eventId: null,
    origin: 'Yaba Bus Stop',
    destination: null,
    departureTime: '17:00',
    note: 'Please be on time',
    description: null,
    vehicleIcon: 'city_car',
    status: 'ACTIVE',
    isDeleted: false,
    expiresAt: new Date('2099-01-01T12:00:00.000Z'),
    driver: {
      id: 'driver-1',
      username: 'captain',
    },
    event: {
      id: 'event-1',
      title: 'GatherGo Live',
      startDate: new Date('2099-01-01T09:00:00.000Z'),
      imageUrl: 'https://example.com/event.png',
    },
    passengers: [{ userId: 'passenger-1' }],
    _count: {
      passengers: 1,
    },
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CarpoolService,
        {
          provide: PrismaService,
          useValue: prismaMock,
        },
        {
          provide: MessageService,
          useValue: messageServiceMock,
        },
        {
          provide: MessageGateway,
          useValue: messageGatewayMock,
        },
        {
          provide: NotificationService,
          useValue: notificationServiceMock,
        },
        {
          provide: RedisPubSubService,
          useValue: pubsubServiceMock,
        },
      ],
    }).compile();

    service = module.get<CarpoolService>(CarpoolService);
  });

  it('returns both follow directions for home carpool cards in one relationship lookup', async () => {
    const drivers = ['following', 'follower', 'mutual', 'unrelated', 'viewer'];
    prismaMock.carpool.findMany
      .mockResolvedValueOnce(
        drivers.map((driverId) => ({ ...baseCarpool, id: driverId, driverId })),
      )
      .mockResolvedValue([]);
    prismaMock.ticket.findMany.mockResolvedValue([]);
    prismaMock.userFollow.findMany.mockResolvedValue([
      { followerId: 'viewer', followingId: 'following' },
      { followerId: 'follower', followingId: 'viewer' },
      { followerId: 'viewer', followingId: 'mutual' },
      { followerId: 'mutual', followingId: 'viewer' },
    ]);
    const result = await service.getForYouCarpools('viewer', {});
    expect(
      result.map(({ isFollowingDriver, isFollowedByDriver }) => [
        isFollowingDriver,
        isFollowedByDriver,
      ]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [false, false],
      [false, false],
    ]);
    expect(prismaMock.userFollow.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.userFollow.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { followerId: 'viewer', followingId: { in: drivers.slice(0, 4) } },
          { followerId: { in: drivers.slice(0, 4) }, followingId: 'viewer' },
        ],
      },
      select: { followerId: true, followingId: true },
    });
  });

  it('does not query relationships when there are no suggested carpools', async () => {
    prismaMock.carpool.findMany.mockResolvedValue([]);
    prismaMock.ticket.findMany.mockResolvedValue([]);
    expect(await service.getForYouCarpools('viewer', {})).toEqual([]);
    expect(prismaMock.userFollow.findMany).not.toHaveBeenCalled();
  });

  it('returns viewer relationships for every requester and the driver in one lookup', async () => {
    const riderIds = ['following', 'follower', 'mutual', 'unrelated', 'viewer'];
    const passengers = [...riderIds, 'mutual'].map((userId, index) => ({
      id: `request-${index}`,
      userId,
      status: index % 2 === 0 ? 'PENDING' : 'ACCEPTED',
      user: { id: userId, username: userId, profilePicUrlTN: null },
    }));
    prismaMock.carpool.findUnique.mockResolvedValue({
      ...baseCarpool,
      passengers,
    });
    prismaMock.userFollow.findMany.mockResolvedValue([
      { followerId: 'viewer', followingId: 'driver-1' },
      { followerId: 'driver-1', followingId: 'viewer' },
      { followerId: 'viewer', followingId: 'following' },
      { followerId: 'follower', followingId: 'viewer' },
      { followerId: 'viewer', followingId: 'mutual' },
      { followerId: 'mutual', followingId: 'viewer' },
    ]);

    const result = await service.findOne('carpool-1', 'viewer');

    expect(result.isFollowingDriver).toBe(true);
    expect(result.isFollowedByDriver).toBe(true);
    expect(result.passengers).toEqual(
      passengers.map((passenger, index) => ({
        ...passenger,
        isFollowingRequester: [0, 2, 5].includes(index),
        isFollowedByRequester: [1, 2, 5].includes(index),
      })),
    );
    const userIds = ['driver-1', ...riderIds.slice(0, 4)];
    expect(prismaMock.userFollow.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.userFollow.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { followerId: 'viewer', followingId: { in: userIds } },
          { followerId: { in: userIds }, followingId: 'viewer' },
        ],
      },
      select: { followerId: true, followingId: true },
    });
  });

  it('returns no relationship tags for an empty ride owned by the viewer', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue({
      ...baseCarpool,
      passengers: [],
    });

    const result = await service.findOne('carpool-1', 'driver-1');

    expect(result.passengers).toEqual([]);
    expect(result.isFollowingDriver).toBe(false);
    expect(result.isFollowedByDriver).toBe(false);
    expect(prismaMock.userFollow.findMany).not.toHaveBeenCalled();
  });

  it('rejects a missing ride before looking up requester relationships', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing', 'viewer')).rejects.toThrow(
      'Carpool not found',
    );
    expect(prismaMock.userFollow.findMany).not.toHaveBeenCalled();
  });

  it('preserves ranking and returns both follow directions for event carpool cards', async () => {
    prismaMock.event.findUnique.mockResolvedValue({ id: 'event-1' });
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: 4n }])
      .mockResolvedValueOnce(
        [
          [true, false],
          [false, true],
          [true, true],
          [false, false],
        ].map(([isFollowedOwner, isFollowedByDriver], index) => ({
          ...baseCarpool,
          id: `ride-${index}`,
          driverUsername: 'captain',
          availableSeats: 3,
          pricePerSeat: 0,
          acceptedPassengers: 0,
          distanceKm: null,
          isFollowedOwner,
          isFollowedByDriver,
          isMember: index === 0,
        })),
      );
    const result = await service.getPaginatedEventCarpools(
      'viewer',
      'event-1',
      {},
    );
    expect(
      result.data.map(({ isFollowingDriver, isFollowedByDriver }) => [
        isFollowingDriver,
        isFollowedByDriver,
      ]),
    ).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ]);
    expect(result.data.map(({ ranking }) => ranking.primaryReason)).toEqual([
      'followed_owner',
      'others',
      'followed_owner',
      'others',
    ]);
    expect(result.data.map(({ isMember }) => isMember)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(prismaMock.$queryRawUnsafe).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(
        /follower\."followerId" = c\."driverId"[\s\S]*follower\."followingId" = \$1/,
      ),
      'viewer',
      'event-1',
      false,
      null,
      null,
      10000,
      20,
      0,
    );
  });

  it('marks drivers and accepted riders as members without including pending or removed riders', async () => {
    prismaMock.carpool.findMany
      .mockResolvedValueOnce([
        { ...baseCarpool, id: 'own', driverId: 'viewer' },
        ...['ACCEPTED', 'PENDING', 'REMOVED', 'DECLINED'].map((status) => ({
          ...baseCarpool,
          id: status,
          passengers: [{ userId: 'viewer', status }],
        })),
        { ...baseCarpool, id: 'other', passengers: [] },
      ])
      .mockResolvedValue([]);
    prismaMock.ticket.findMany.mockResolvedValue([]);
    prismaMock.userFollow.findMany.mockResolvedValue([]);
    const result = await service.getForYouCarpools('viewer', {});
    expect(result.map(({ isMember }) => isMember)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('queues a chat update and realtime event when ride details change', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue(baseCarpool);
    prismaMock.carpool.findMany.mockResolvedValue([]);
    prismaMock.carpool.update.mockResolvedValue({
      ...baseCarpool,
      origin: 'Ojota Bus Stop',
      departureTime: '18:30',
      note: 'Please be there 10 minutes early',
    });

    await service.update('driver-1', 'carpool-1', {
      origin: '  Ojota Bus Stop  ',
      departureTime: '18:30',
      note: 'Please be there 10 minutes early',
    });

    expect(prismaMock.carpool.update).toHaveBeenCalledWith({
      where: { id: 'carpool-1' },
      data: {
        origin: 'Ojota Bus Stop',
        departureTime: '18:30',
        note: 'Please be there 10 minutes early',
      },
    });

    expect(messageServiceMock.createMessage).toHaveBeenCalledWith(
      'driver-1',
      'carpool-1',
      expect.objectContaining({
        content: expect.stringContaining('Ride update from @captain'),
        tempId: expect.stringMatching(/^ride-update-carpool-1-/),
      }),
    );

    expect(pubsubServiceMock.publishCarpoolUpdate).toHaveBeenCalledWith(
      'carpool_updated',
      'carpool-1',
      {
        origin: 'Ojota Bus Stop',
        departureTime: '18:30',
        note: 'Please be there 10 minutes early',
      },
      'driver-1',
    );

    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith({
      recipientIds: ['passenger-1'],
      title: 'Ride details updated',
      message: expect.stringContaining('Ride update from @captain'),
      type: 'carpool_update',
      imageUrl: 'https://example.com/event.png',
      link: '/chat/carpool-1',
      data: {
        carpoolId: 'carpool-1',
      },
    });
  });

  it('updates ride vibe silently without posting a chat message', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue(baseCarpool);
    prismaMock.carpool.update.mockResolvedValue({
      ...baseCarpool,
      vehicleIcon: 'mystery_machine',
    });

    await service.update('driver-1', 'carpool-1', {
      vehicleIcon: 'mystery_machine',
    });

    expect(prismaMock.carpool.update).toHaveBeenCalledWith({
      where: { id: 'carpool-1' },
      data: {
        vehicleIcon: 'mystery_machine',
      },
    });
    expect(messageServiceMock.createMessage).not.toHaveBeenCalled();
    expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    expect(pubsubServiceMock.publishCarpoolUpdate).toHaveBeenCalledWith(
      'carpool_updated',
      'carpool-1',
      {
        vehicleIcon: 'mystery_machine',
      },
      'driver-1',
    );
  });

  it('skips writes entirely when submitted values did not change', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue(baseCarpool);

    const result = await service.update('driver-1', 'carpool-1', {
      origin: 'Yaba Bus Stop',
      departureTime: '17:00',
      note: 'Please be on time',
    });

    expect(result).toEqual(baseCarpool);
    expect(prismaMock.carpool.update).not.toHaveBeenCalled();
    expect(messageServiceMock.createMessage).not.toHaveBeenCalled();
    expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    expect(pubsubServiceMock.publishCarpoolUpdate).not.toHaveBeenCalled();
  });

  it('requests a ride without start point coordinates', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue({
      ...baseCarpool,
      availableSeats: 3,
      _count: {
        passengers: 0,
      },
    });
    prismaMock.carpoolPassenger.findFirst.mockResolvedValue(null);
    prismaMock.carpoolPassenger.count.mockResolvedValue(0);
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      {
        id: 'passenger-request-1',
        userId: 'passenger-1',
        carpoolId: 'carpool-1',
        note: null,
        status: 'PENDING',
        origin: 'Wawa',
        startPoint: null,
        requestedAt: new Date('2099-01-01T12:00:00.000Z'),
        estimatedDistance: null,
      },
    ]);

    const result = await service.requestRide(
      'passenger-1',
      'carpool-1',
      {
        origin: 'Wawa',
      },
      'deybee',
    );

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        id: 'passenger-request-1',
        origin: 'Wawa',
        startPoint: null,
        estimatedDistance: null,
      }),
    });
    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(1);

    const [sql, ...params] = prismaMock.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('NULL');
    expect(sql).toContain('$5');
    expect(sql).not.toContain('$6');
    expect(sql).not.toContain('$7');
    expect(params).toEqual(['passenger-1', 'carpool-1', null, 'Wawa', null]);
  });

  it.each(['REMOVED', 'PENDING', 'ACCEPTED'])(
    'rejects a repeat request for a %s rider without a success result or notification',
    async (status) => {
      prismaMock.carpool.findUnique.mockResolvedValue({
        ...baseCarpool,
        availableSeats: 3,
        _count: { passengers: 0 },
      });
      prismaMock.carpoolPassenger.findFirst.mockResolvedValue({ status });

      await expect(
        service.requestRide(
          'passenger-1',
          'carpool-1',
          { origin: 'Wawa' },
          'ada',
        ),
      ).rejects.toThrow(
        status === 'REMOVED'
          ? 'You were removed from this ride and cannot request it again'
          : 'You already requested this ride',
      );
      expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled();
      expect(notificationServiceMock.createNotification).not.toHaveBeenCalled();
    },
  );

  it('creates a fresh request after a decline while retaining the earlier record', async () => {
    const previous = { id: 'old-request', status: 'DECLINED' };
    prismaMock.carpool.findUnique.mockResolvedValue({
      ...baseCarpool,
      availableSeats: 3,
      _count: { passengers: 0 },
    });
    prismaMock.carpoolPassenger.findFirst.mockImplementation(
      ({ where }: { where: { status: { in: string[] } } }) =>
        Promise.resolve(
          where.status.in.includes(previous.status) ? previous : null,
        ),
    );
    prismaMock.carpoolPassenger.count.mockResolvedValue(0);
    prismaMock.$queryRawUnsafe.mockResolvedValue([
      { id: 'new-request', status: 'PENDING' },
    ]);

    await expect(
      service.requestRide(
        'passenger-1',
        'carpool-1',
        { origin: 'Wawa' },
        'ada',
      ),
    ).resolves.toEqual({
      success: true,
      data: { id: 'new-request', status: 'PENDING' },
    });
    expect(prismaMock.carpoolPassenger.update).not.toHaveBeenCalled();
    expect(previous.status).toBe('DECLINED');
    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'carpool_request',
        link: '/carpool/carpool-1',
      }),
    );
  });

  it.each(['ACCEPTED', 'DECLINED'] as const)(
    'publishes the correct membership event and notification destination for %s',
    async (action) => {
      const request = {
        id: 'request-1',
        userId: 'passenger-1',
        carpoolId: 'carpool-1',
        status: 'PENDING',
        carpool: { ...baseCarpool, availableSeats: 3 },
        user: { profilePicUrlTN: null },
      };
      prismaMock.carpoolPassenger.findUnique.mockResolvedValue(request);
      prismaMock.carpoolPassenger.update.mockResolvedValue({
        ...request,
        status: action,
      });
      prismaMock.$transaction.mockImplementation((writes: Promise<unknown>[]) =>
        Promise.all(writes),
      );
      messageServiceMock.getConversationTray.mockResolvedValue([]);

      await service.respondToRequest('driver-1', 'request-1', { action });
      expect(prismaMock.carpoolPassenger.update).toHaveBeenCalledWith({
        where: { id: 'request-1' },
        data: { status: action },
      });
      expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type:
            action === 'ACCEPTED'
              ? 'carpool_accepted_request'
              : 'carpool_rejected_request',
          link:
            action === 'ACCEPTED' ? '/chat/carpool-1' : '/carpool/carpool-1',
        }),
      );
      expect(pubsubServiceMock.publishCarpoolUpdate).toHaveBeenCalledWith(
        action === 'ACCEPTED' ? 'passenger_added' : 'carpool_updated',
        'carpool-1',
        action === 'ACCEPTED'
          ? { id: 'passenger-1', profilePicUrlTN: null, status: 'ACCEPTED' }
          : {},
        'passenger-1',
      );
    },
  );

  it('retains a removed rider as history and links their notification to the ride', async () => {
    prismaMock.carpoolPassenger.findUnique.mockResolvedValue({
      id: 'request-1',
      userId: 'passenger-1',
      carpoolId: 'carpool-1',
      status: 'ACCEPTED',
      carpool: baseCarpool,
    });
    await service.removePassenger('driver-1', 'request-1');
    expect(prismaMock.carpoolPassenger.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: { status: 'REMOVED' },
    });
    expect(notificationServiceMock.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'carpool_removed',
        link: '/carpool/carpool-1',
      }),
    );
  });

  it('does not change a previous declined request into a removal', async () => {
    prismaMock.carpoolPassenger.findUnique.mockResolvedValue({
      id: 'request-1',
      status: 'DECLINED',
      carpool: baseCarpool,
    });
    await expect(
      service.removePassenger('driver-1', 'request-1'),
    ).rejects.toThrow('Only an accepted passenger can be removed');
    expect(prismaMock.carpoolPassenger.update).not.toHaveBeenCalled();
  });

  it('requests a ride with start point coordinates', async () => {
    prismaMock.carpool.findUnique.mockResolvedValue({
      ...baseCarpool,
      availableSeats: 3,
      _count: {
        passengers: 0,
      },
    });
    prismaMock.carpoolPassenger.findFirst.mockResolvedValue(null);
    prismaMock.carpoolPassenger.count.mockResolvedValue(0);
    prismaMock.$queryRawUnsafe
      .mockResolvedValueOnce([{ distance: 2500 }])
      .mockResolvedValueOnce([
        {
          id: 'passenger-request-1',
          userId: 'passenger-1',
          carpoolId: 'carpool-1',
          note: null,
          status: 'PENDING',
          origin: 'Wawa',
          startPoint: 'POINT(3.1 6.2)',
          requestedAt: new Date('2099-01-01T12:00:00.000Z'),
          estimatedDistance: '2.5 km',
        },
      ]);

    await service.requestRide(
      'passenger-1',
      'carpool-1',
      {
        origin: 'Wawa',
        startPoint: {
          lng: 3.1,
          lat: 6.2,
        },
      },
      'deybee',
    );

    expect(prismaMock.$queryRawUnsafe).toHaveBeenCalledTimes(2);

    const [sql, ...params] = prismaMock.$queryRawUnsafe.mock.calls[1];
    expect(sql).toContain('ST_SetSRID(ST_MakePoint($5, $6), 4326)');
    expect(sql).toContain('$7');
    expect(params).toEqual([
      'passenger-1',
      'carpool-1',
      null,
      'Wawa',
      3.1,
      6.2,
      '2.5 km',
    ]);
  });
});

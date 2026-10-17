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
      count: jest.fn(),
    },
    $queryRawUnsafe: jest.fn(),
  };

  const messageServiceMock = {
    createMessage: jest.fn(),
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

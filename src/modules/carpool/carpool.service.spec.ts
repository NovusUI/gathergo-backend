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
      findMany: jest.fn(),
      update: jest.fn(),
    },
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
  };

  beforeEach(async () => {
    jest.clearAllMocks();

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
});

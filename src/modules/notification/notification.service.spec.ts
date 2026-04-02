import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  const prisma = {
    notification: {
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
  } as any;
  const redisPubSub = {} as any;
  const redisService = {
    client: {
      get: jest.fn(),
      set: jest.fn(),
      incr: jest.fn(),
    },
  } as any;
  const notificationsService = {} as any;

  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService(
      prisma,
      redisPubSub,
      redisService,
      notificationsService,
    );
  });

  it('re-syncs unread count when redis drifts below zero', async () => {
    redisService.client.get.mockResolvedValue('-1');
    redisService.client.set.mockResolvedValue('OK');
    prisma.notification.count.mockResolvedValue(3);

    await expect(service.getUnreadCount('user-1')).resolves.toBe(3);

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: {
        recipientId: 'user-1',
        read: false,
      },
    });
    expect(redisService.client.set).toHaveBeenCalledWith(
      'notification:unread:user-1',
      3,
    );
  });
});

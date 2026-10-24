import { Test } from '@nestjs/testing';
import { FirebaseService } from '../firebase/firebase.service';
import { RedisService } from 'src/redis/redis.service';
import { Expo } from 'expo-server-sdk';
import { getNotificationSound } from '../notification/notification-sounds';
import { NotificationsService } from './backgroundnotification.service';

describe('NotificationsService', () => {
  const store = new Map<string, string>();
  const redisClient = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    keys: jest.fn((pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Promise.resolve(
        Array.from(store.keys()).filter((key) => key.startsWith(prefix)),
      );
    }),
  };
  const firebaseService = {
    validateTokens: jest.fn(),
    sendRegularNotification: jest.fn(),
    sendMessageNotification: jest.fn(),
  };
  const redisService = {
    client: redisClient,
  };

  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    store.clear();
    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: FirebaseService, useValue: firebaseService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  it('reassigns a push token to the latest logged-in user', async () => {
    const token = 'ExponentPushToken[abc123]';

    await redisClient.set(
      'fcm_tokens:user-old',
      JSON.stringify([
        {
          userId: 'user-old',
          token,
          platform: 'ios',
          createdAt: new Date().toISOString(),
        },
      ]),
    );

    await service.registerToken('user-new', token, 'ios');

    expect(JSON.parse(store.get('fcm_tokens:user-old') || '[]')).toEqual([]);
    expect(JSON.parse(store.get('fcm_tokens:user-new') || '[]')).toEqual([
      expect.objectContaining({
        userId: 'user-new',
        token,
        platform: 'ios',
      }),
    ]);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['carpool_request', {}],
    ['carpool_accepted_request', {}],
    ['carpool_rejected_request', {}],
    ['FEED_FRENZY_DONATION_HIGH', { isFrenzy: true }],
    ['FEED_DONATION_100_PERCENT', { isMilestone: true }],
    ['event_donation', {}],
  ])(
    'sends the matching sound and channel through Expo for %s',
    async (type, data) => {
      jest
        .spyOn(service, 'getMultipleUserTokens')
        .mockResolvedValue(['ExponentPushToken[test]', 'fcm-token']);
      jest
        .spyOn(Expo.prototype, 'chunkPushNotifications')
        .mockImplementation((messages) => [messages]);
      const send = jest
        .spyOn(Expo.prototype, 'sendPushNotificationsAsync')
        .mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
      await service.sendRegularNotification({
        userIds: ['user-1'],
        type,
        title: 'Update',
        message: 'Your update',
        link: '/event/event-1',
        data,
      });
      expect(send.mock.calls[0][0]).toMatchObject([
        {
          to: 'ExponentPushToken[test]',
          ...getNotificationSound(type, {
            isMilestone: 'isMilestone' in data && data.isMilestone === true,
          }),
          title: 'Update',
          body: 'Your update',
          data: { type, link: '/event/event-1', ...data },
        },
      ]);
      expect(firebaseService.sendRegularNotification).toHaveBeenCalledWith({
        tokens: ['fcm-token'],
        type,
        title: 'Update',
        message: 'Your update',
        link: '/event/event-1',
        data,
      });
    },
  );

  it('uses general audio for chat and preserves the message navigation data', async () => {
    jest
      .spyOn(service, 'getMultipleUserTokens')
      .mockResolvedValue(['ExponentPushToken[test]', 'fcm-token']);
    jest
      .spyOn(Expo.prototype, 'chunkPushNotifications')
      .mockImplementation((messages) => [messages]);
    const send = jest
      .spyOn(Expo.prototype, 'sendPushNotificationsAsync')
      .mockResolvedValue([{ status: 'ok', id: 'ticket-1' }]);
    const message = {
      id: 'message-1',
      sender: { username: 'Bola' },
      content: 'On my way',
      carpoolId: 'ride-1',
      senderId: 'sender-1',
      createdAt: new Date(),
    };
    await service.sendMessageNotification({
      userIds: ['user-1'],
      message,
      carpoolId: 'ride-1',
      senderName: 'Bola',
      senderId: 'sender-1',
      link: '/chat/ride-1',
    });
    expect(send.mock.calls[0][0]).toMatchObject([
      {
        ...getNotificationSound('NEW_MESSAGE'),
        title: 'New message from Bola',
        body: 'On my way',
        data: {
          type: 'NEW_MESSAGE',
          messageId: 'message-1',
          carpoolId: 'ride-1',
          link: '/chat/ride-1',
        },
      },
    ]);
    expect(firebaseService.sendMessageNotification).toHaveBeenCalledTimes(1);
    expect(firebaseService.sendMessageNotification).toHaveBeenCalledWith({
      tokens: ['fcm-token'],
      message,
      carpoolId: 'ride-1',
      senderName: 'Bola',
      senderId: 'sender-1',
      messageId: 'message-1',
    });
  });

  it('does not attempt to send when there are no registered tokens', async () => {
    jest.spyOn(service, 'getMultipleUserTokens').mockResolvedValue([]);
    const send = jest.spyOn(Expo.prototype, 'sendPushNotificationsAsync');
    await service.sendRegularNotification({
      userIds: ['user-1'],
      type: 'system',
      title: 'Update',
      message: 'Update',
    });
    expect(send).not.toHaveBeenCalled();
    expect(firebaseService.sendRegularNotification).not.toHaveBeenCalled();
  });
});

import { NotificationsService } from './backgroundnotification.service';

describe('NotificationsService', () => {
  const store = new Map<string, string>();
  const redisClient = {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
    }),
  };
  const firebaseService = {
    validateTokens: jest.fn(),
  } as any;
  const redisService = {
    client: redisClient,
  } as any;

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    service = new NotificationsService(firebaseService, redisService);
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
});

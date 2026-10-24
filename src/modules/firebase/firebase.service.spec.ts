import type * as admin from 'firebase-admin';
import { ok as assert } from 'node:assert/strict';
import { FirebaseService } from './firebase.service';
import { getNotificationSound } from '../notification/notification-sounds';

const mockSend = jest.fn<
  Promise<admin.messaging.BatchResponse>,
  [admin.messaging.MulticastMessage]
>();
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(() => ({
    messaging: () => ({ sendEachForMulticast: mockSend }),
  })),
  credential: { cert: jest.fn() },
  storage: () => ({ bucket: () => ({}) }),
}));

describe('Gogo sounds through direct FCM delivery', () => {
  let service: FirebaseService;
  const previousAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{}';
    mockSend.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });
    service = new FirebaseService();
  });
  afterAll(() => {
    if (previousAccount === undefined)
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousAccount;
  });

  it.each([
    ['carpool_request', false],
    ['carpool_accepted_request', false],
    ['carpool_rejected_request', false],
    ['FEED_FRENZY_TICKET_HIGH', false],
    ['FEED_DONATION_100_PERCENT', true],
    ['event_donation', false],
  ])(
    'delivers %s with Android resource/channel and iOS filename',
    async (type, isMilestone) => {
      const { sound, channelId } = getNotificationSound(type, { isMilestone });
      await service.sendRegularNotification({
        tokens: ['fcm-token'],
        title: 'Update',
        message: 'Your update',
        link: '/event/event-1',
        type,
        data: {
          eventId: 'event-1',
          isMilestone,
          count: 25,
          details: { progress: 50 },
          optionalAmount: undefined,
        },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0][0]).toMatchObject({
        tokens: ['fcm-token'],
        notification: { title: 'Update', body: 'Your update' },
        android: {
          notification: {
            channelId,
            sound: sound.replace('.wav', ''),
          },
        },
        apns: { payload: { aps: { sound, badge: 1 } } },
        data: {
          type,
          link: '/event/event-1',
          eventId: 'event-1',
          isMilestone: String(isMilestone),
          count: '25',
          details: '{"progress":50}',
        },
      });
      expect(mockSend.mock.calls[0][0].data).not.toHaveProperty(
        'optionalAmount',
      );
    },
  );

  it('sends chat with general audio, the real sender, and string-only FCM data', async () => {
    const message = {
      id: 'message-1',
      sender: { username: 'Bola' },
      carpoolId: 'ride-1',
      senderId: 'sender-1',
      content: 'Hello',
      createdAt: new Date('2026-10-24T10:00:00Z'),
    };
    await service.sendMessageNotification({
      tokens: ['fcm-token'],
      message,
      senderName: 'Bola',
    });
    const payload = mockSend.mock.calls[0][0];
    expect(payload.notification).toEqual({
      title: 'New message from Bola',
      body: 'Hello',
    });
    expect(payload).toMatchObject({
      android: {
        notification: { channelId: 'gogo_general_v1', sound: 'gogo_general' },
      },
      apns: { payload: { aps: { sound: 'gogo_general.wav' } } },
    });
    assert(payload.data);
    expect(payload.data.createdAt).toBe('2026-10-24T10:00:00.000Z');
    expect(payload.data.message).toBe(JSON.stringify(message));
    expect(
      Object.values(payload.data).every((value) => typeof value === 'string'),
    ).toBe(true);
  });

  it('retains chunked delivery for more than 500 device tokens', async () => {
    const tokens = Array.from({ length: 501 }, (_, index) => `token-${index}`);
    await service.sendRegularNotification({
      tokens,
      type: 'system',
      title: 'Update',
      message: 'Update',
    });
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(
      mockSend.mock.calls.map(([payload]) => payload.tokens.length),
    ).toEqual([500, 1]);
  });

  it('does not call Firebase for an empty token list', async () => {
    await service.sendRegularNotification({
      tokens: [],
      type: 'system',
      title: 'Update',
      message: 'Update',
    });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

import {
  getNotificationSound,
  NOTIFICATION_SOUNDS,
} from './notification-sounds';
import { notificationConstants } from 'src/common/constants';

describe('notification sound selection', () => {
  it.each([
    notificationConstants.CARPOOL_NOTIFICATION_TYPE_REQUEST,
    notificationConstants.CARPOOL_NOTIFICATION_TYPE_ACCEPTED,
  ])('uses the positive carpool sound for %s', (type) => {
    expect(getNotificationSound(type)).toBe(
      NOTIFICATION_SOUNDS.carpoolPositive,
    );
  });

  it('uses the rejection sound only for a rejected request', () => {
    expect(
      getNotificationSound(
        notificationConstants.CARPOOL_NOTIFICATION_TYPE_REJECTED,
      ),
    ).toBe(NOTIFICATION_SOUNDS.carpoolRejection);
    for (const type of [
      notificationConstants.CARPOOL_NOTIFICATION_TYPE_CANCELLED,
      notificationConstants.CARPOOL_NOTIFICATION_TYPE_REMOVED,
      notificationConstants.CARPOOL_NOTIFICATION_TYPE_LEFT,
      'carpool_update',
    ])
      expect(getNotificationSound(type)).toBe(NOTIFICATION_SOUNDS.general);
  });

  it.each(['DONATION', 'TICKET', 'REGISTRATION'])(
    'celebrates each %s frenzy intensity',
    (kind) => {
      for (const level of ['LOW', 'MEDIUM', 'HIGH']) {
        expect(getNotificationSound(`FEED_FRENZY_${kind}_${level}`)).toBe(
          NOTIFICATION_SOUNDS.celebration,
        );
      }
    },
  );

  it.each([
    'TICKET_ALMOST_SOLD_OUT',
    'TICKET_SOLD_OUT',
    'TICKET_PROGRESS_MILESTONE',
    'REGISTRATION_ALMOST_FULL',
    'REGISTRATION_FULL',
    'REGISTRATION_PROGRESS_MILESTONE',
    'DONATION_50_PERCENT',
    'DONATION_75_PERCENT',
    'DONATION_90_PERCENT',
    'DONATION_95_PERCENT',
    'DONATION_100_PERCENT',
    'DONATION_PROGRESS_MILESTONE',
  ])(
    'celebrates milestone notifications marked by the feed service: %s',
    (type) => {
      expect(getNotificationSound(`FEED_${type}`, { isMilestone: true })).toBe(
        NOTIFICATION_SOUNDS.celebration,
      );
    },
  );

  it.each([
    'NEW_MESSAGE',
    'event_ticket_sale',
    'event_registration',
    'event_donation',
    'kyc_verification_update',
    'system',
  ])('uses general audio for %s', (type) => {
    expect(getNotificationSound(type)).toBe(NOTIFICATION_SOUNDS.general);
  });
});

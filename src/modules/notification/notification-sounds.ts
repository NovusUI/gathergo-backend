import { notificationConstants } from 'src/common/constants';

// These filenames and channel IDs must match the mobile app's bundled resources.
export const NOTIFICATION_SOUNDS = {
  general: { sound: 'gogo_general.wav', channelId: 'gogo_general_v1' },
  carpoolPositive: {
    sound: 'gogo_carpool_positive.wav',
    channelId: 'gogo_carpool_positive_v1',
  },
  carpoolRejection: {
    sound: 'gogo_carpool_rejection.wav',
    channelId: 'gogo_carpool_rejection_v1',
  },
  celebration: {
    sound: 'gogo_celebration.wav',
    channelId: 'gogo_celebration_v1',
  },
} as const;

export function getNotificationSound(
  type: string,
  { isMilestone = false }: { isMilestone?: boolean } = {},
) {
  switch (type) {
    case notificationConstants.CARPOOL_NOTIFICATION_TYPE_REQUEST:
    case notificationConstants.CARPOOL_NOTIFICATION_TYPE_ACCEPTED:
      return NOTIFICATION_SOUNDS.carpoolPositive;
    case notificationConstants.CARPOOL_NOTIFICATION_TYPE_REJECTED:
      return NOTIFICATION_SOUNDS.carpoolRejection;
    default:
      return type.startsWith('FEED_FRENZY_') || isMilestone
        ? NOTIFICATION_SOUNDS.celebration
        : NOTIFICATION_SOUNDS.general;
  }
}

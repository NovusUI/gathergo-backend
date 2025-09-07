// notification.types.ts
export type Notification = {
    id: string;
    type: string;
    title: string;
    message: string;
    imageUrl: string | null;
    link: string | null;
    read: boolean;
    createdAt: Date;
    updatedAt: Date;
    recipientId: string;
    senderId: string | null;
    sender?: {
      id: string;
      username: string;
      profilePicUrl?: string;
    };
  };
  
  export enum NotificationType {
    FRIEND_REQUEST = 'friend_request',
    MESSAGE = 'message',
    SYSTEM = 'system',
    CARPOOL_UPDATE = 'carpool_update',
    EVENT_REMINDER = 'event_reminder',
  }
  
  export type CreateNotificationDto = {
    recipientId: string;
    type: NotificationType;
    title: string;
    message: string;
    imageUrl?: string;
    link?: string;
    senderId?: string;
  };
  
  export type NotificationResponse = Omit<Notification, 'recipientId'> & {
    recipient?: {
      id: string;
      username: string;
    };
  };
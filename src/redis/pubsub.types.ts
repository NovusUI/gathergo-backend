// pubsub.types.ts
export type PubSubMessage = {
  type: 'chat' | 'typing' | 'tray_update';
  carpoolId?: string;
  senderId: string;
  message?: any; // Your message type
  isTyping?: boolean;
  recipientId?: string; // For direct messages
};

export type PubSubNotification = {
  type: string;
  notificationType: string; // e.g., 'friend_request', 'carpool_update'
  recipientId: string;
  senderId?: string;
  data: {
    id: string;
    title: string;
    message: string;
    imageUrl?: string | null;
    link?: string | null;
    createdAt: Date;
    read: boolean;
  };
};

export type PubSubFeedMessage = {
  type: 'feed:new' | 'feed:updated' | 'feed:deleted' | 'feed:pinned';
  eventId: string;
  feed: any;
  userId?: string; // Optional: who triggered the action
};

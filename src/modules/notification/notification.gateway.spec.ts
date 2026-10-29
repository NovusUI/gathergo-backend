import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Socket } from 'socket.io';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { NotificationGateway } from './notification.gateway';
import { NotificationService } from './notification.service';

describe('notification read confirmation', () => {
  let gateway: NotificationGateway;
  const markAllAsRead = jest.fn<
    ReturnType<NotificationService['markAllAsRead']>,
    Parameters<NotificationService['markAllAsRead']>
  >();
  const getNotificationTray = jest.fn<
    ReturnType<NotificationService['getNotificationTray']>,
    Parameters<NotificationService['getNotificationTray']>
  >();
  const handshake: Socket['handshake'] = {
    auth: { user: { sub: 'user-1' } },
    headers: {},
    time: '',
    address: '127.0.0.1',
    xdomain: false,
    secure: false,
    issued: 0,
    url: '/',
    query: {},
  };
  const emit = jest.fn<
    ReturnType<Socket['emit']>,
    Parameters<Socket['emit']>
  >();
  // The socket test double implements only the members used by this handler.
  const client = { handshake, emit } as unknown as Socket;
  const tray = { notifications: [], totalUnread: 0, hasMore: false };

  beforeEach(async () => {
    jest.clearAllMocks();
    markAllAsRead.mockReset().mockResolvedValue(undefined);
    getNotificationTray.mockReset().mockResolvedValue(tray);
    const module = await Test.createTestingModule({
      providers: [
        NotificationGateway,
        {
          provide: NotificationService,
          useValue: { markAllAsRead, getNotificationTray },
        },
        { provide: RedisPubSubService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();
    gateway = module.get(NotificationGateway);
  });

  it('confirms the authenticated user’s read state before refreshing the tray', async () => {
    await gateway.handleMarkAllAsRead(client);
    expect(markAllAsRead).toHaveBeenCalledWith('user-1');
    expect(getNotificationTray).toHaveBeenCalledWith('user-1');
    expect(emit.mock.calls).toEqual([
      ['allNotificationsRead'],
      ['notificationTray', tray],
    ]);
  });

  it('does not clear the client count until the read write finishes', async () => {
    let completeWrite = () => {};
    markAllAsRead.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeWrite = resolve;
        }),
    );
    const handling = gateway.handleMarkAllAsRead(client);
    expect(emit).not.toHaveBeenCalled();
    completeWrite();
    await handling;
    expect(emit).toHaveBeenCalledWith('allNotificationsRead');
  });

  it('does not confirm or fetch a successful tray when the write fails', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    try {
      markAllAsRead.mockRejectedValueOnce(new Error('Database unavailable'));
      await gateway.handleMarkAllAsRead(client);
      expect(getNotificationTray).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalledWith('allNotificationsRead');
      expect(emit).toHaveBeenCalledWith(
        'error',
        'Failed to mark all notifications as read',
      );
    } finally {
      log.mockRestore();
    }
  });
});

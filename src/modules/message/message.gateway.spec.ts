import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { MessageService } from './message.service';
import { MessageGateway } from './message.gateway';
import { validateSync } from 'class-validator';
import { CreateMessageDto } from './dtos/create-message.dto';
import type { Socket } from 'socket.io';

describe('chat send acknowledgments', () => {
  let gateway: MessageGateway;
  const createMessage = jest.fn<
    ReturnType<MessageService['createMessage']>,
    Parameters<MessageService['createMessage']>
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
  // This handler only reads the socket handshake.
  const client = { handshake } as Socket;
  const payload = { carpoolId: 'room-1', tempId: 'temp-1', content: 'Hello' };
  beforeEach(async () => {
    createMessage.mockReset();
    const module = await Test.createTestingModule({
      providers: [
        MessageGateway,
        { provide: MessageService, useValue: { createMessage } },
        { provide: RedisPubSubService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();
    gateway = module.get(MessageGateway);
  });
  it('returns the saved message as the direct receipt', async () => {
    const message: Awaited<ReturnType<MessageService['createMessage']>> = {
      id: 'saved-1',
      tempId: 'temp-1',
      content: 'Hello',
      carpoolId: 'room-1',
      senderId: 'user-1',
      createdAt: new Date(),
      isDeleted: false,
      sender: { id: 'user-1', username: null },
      readBy: [],
    };
    createMessage.mockResolvedValue(message);
    expect(await gateway.handleSendMessage(client, payload)).toEqual({
      ok: true,
      message,
    });
  });
  it.each([
    new ForbiddenException('Chat expired'),
    new ConflictException('Key reused'),
  ])('returns a permanent error for a rejected message', async (error) => {
    createMessage.mockRejectedValue(error);
    expect(await gateway.handleSendMessage(client, payload)).toEqual({
      ok: false,
      error: error.message,
      retryable: false,
    });
  });
  it('keeps temporary failures retryable without reporting success', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    try {
      createMessage.mockRejectedValue(new Error('Database unavailable'));
      expect(await gateway.handleSendMessage(client, payload)).toEqual({
        ok: false,
        error: 'Unable to send message. Please try again.',
        retryable: true,
      });
    } finally {
      log.mockRestore();
    }
  });
  it('rejects empty content and missing keys without writing', async () => {
    expect(
      (await gateway.handleSendMessage(client, { ...payload, content: ' ' }))
        .ok,
    ).toBe(false);
    expect(
      (await gateway.handleSendMessage(client, { ...payload, tempId: '' })).ok,
    ).toBe(false);
    expect(createMessage).not.toHaveBeenCalled();
  });
  it('requires a stable retry key in the HTTP contract too', () => {
    expect(
      validateSync(
        Object.assign(new CreateMessageDto(), { content: 'Hello' }),
      ).some((error) => error.property === 'tempId'),
    ).toBe(true);
    expect(
      validateSync(
        Object.assign(new CreateMessageDto(), {
          content: 'Hello',
          tempId: 'temp-1',
        }),
      ),
    ).toEqual([]);
  });
});

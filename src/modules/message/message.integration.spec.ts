import {
  ConflictException,
  ForbiddenException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getJwtSecret } from 'src/config/runtime-env';
import { ResponseInterceptor } from 'src/common/interceptors/response.interceptors';
import { MessageGateway } from './message.gateway';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { NotificationsService } from '../background-notification/backgroundnotification.service';
import { MessageService } from './message.service';

const url = process.env.CHAT_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('chat delivery and retries (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let service: MessageService;
  let app: INestApplication;
  let driverId: string;
  let passengerId: string;
  let outsiderId: string;
  let carpoolId: string;
  const publish = jest.fn<
    ReturnType<RedisPubSubService['publish']>,
    Parameters<RedisPubSubService['publish']>
  >();
  const notify = jest.fn<
    ReturnType<NotificationsService['sendMessageNotification']>,
    Parameters<NotificationsService['sendMessageNotification']>
  >();

  beforeAll(async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('chat_delivery_test')
    ) {
      throw new Error('Use an isolated local chat_delivery_test database.');
    }
    prisma = new PrismaService({ datasources: { db: { url } } });
    await prisma.$connect();
    const module = await Test.createTestingModule({
      providers: [
        MessageService,
        MessageGateway,
        { provide: JwtService, useValue: new JwtService() },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: {} },
        {
          provide: RedisPubSubService,
          useValue: { publish, setSocketServer: jest.fn() },
        },
        {
          provide: NotificationsService,
          useValue: { sendMessageNotification: notify },
        },
      ],
    }).compile();
    service = module.get(MessageService);
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.listen(0, '127.0.0.1');
    const ids = await Promise.all(
      ['driver', 'passenger', 'outsider'].map(async (role) => {
        const id = randomUUID();
        await prisma.user.create({
          data: { id, email: `${id}@chat.test`, username: role + id },
        });
        return id;
      }),
    );
    [driverId, passengerId, outsiderId] = ids;
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    publish.mockResolvedValue(undefined);
    notify.mockResolvedValue(undefined);
    const carpool = await prisma.carpool.create({
      data: {
        driverId,
        origin: 'Library',
        departureTime: '12:00',
        expiresAt: new Date(Date.now() + 3600000),
        passengers: {
          create: { userId: passengerId, origin: 'Gate', status: 'ACCEPTED' },
        },
      },
    });
    carpoolId = carpool.id;
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('real Socket.IO frames return an unwrapped saved receipt and an explicit rejection', async () => {
    const baseUrl = (await app.getUrl()).replace('http:', 'ws:');
    const socket = new WebSocket(
      `${baseUrl}/socket.io/?EIO=4&transport=websocket`,
    );
    const packet = (prefix: string) =>
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.removeEventListener('message', receive);
          reject(new Error('Socket receipt timed out'));
        }, 5000);
        const receive = (event: MessageEvent) => {
          if (typeof event.data !== 'string') return;
          if (event.data === '2') socket.send('3');
          if (event.data.startsWith(prefix)) {
            clearTimeout(timeout);
            socket.removeEventListener('message', receive);
            resolve(event.data);
          }
        };
        socket.addEventListener('message', receive);
      });
    try {
      await packet('0');
      const connected = packet('40');
      socket.send(
        '40' +
          JSON.stringify({
            userId: driverId,
            token: new JwtService().sign(
              { sub: driverId },
              { secret: getJwtSecret() },
            ),
          }),
      );
      await connected;
      const dto = {
        carpoolId,
        content: 'Socket round trip',
        tempId: randomUUID(),
      };
      const receipt = packet('431');
      socket.send('421' + JSON.stringify(['sendMessage', dto]));
      const frame = await receipt;
      const saved = await prisma.message.findFirstOrThrow({
        where: { carpoolId },
      });
      expect(frame).toContain('"ok":true');
      expect(frame).toContain(saved.id);
      expect(frame).toContain('"readBy":[]');
      expect(frame).not.toContain('"status":"success"');
      const replay = packet('432');
      socket.send('422' + JSON.stringify(['sendMessage', dto]));
      expect(await replay).toContain(saved.id);
      expect(await prisma.message.count({ where: { carpoolId } })).toBe(1);
      const rejection = packet('433');
      socket.send(
        '423' + JSON.stringify(['sendMessage', { ...dto, content: 'Changed' }]),
      );
      expect(await rejection).toContain('"retryable":false');
    } finally {
      socket.close();
    }
  });

  it('simultaneous retries save one row and publish/notify once', async () => {
    const dto = { tempId: randomUUID(), content: 'Meet at the library' };
    const messages = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.createMessage(driverId, carpoolId, dto),
      ),
    );
    expect(new Set(messages.map((message) => message.id)).size).toBe(1);
    expect(await prisma.message.count({ where: { carpoolId } })).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(messages[0].readBy).toEqual([]);
    expect(messages[0].sender.id).toBe(driverId);
  });
  it('a lost receipt can be recovered after expiry and membership changes', async () => {
    const dto = { tempId: randomUUID(), content: 'On my way' };
    const original = await service.createMessage(passengerId, carpoolId, dto);
    await prisma.carpool.update({
      where: { id: carpoolId },
      data: { expiresAt: new Date(0) },
    });
    await prisma.carpoolPassenger.updateMany({
      where: { userId: passengerId, carpoolId },
      data: { status: 'REMOVED' },
    });
    const receipt = await service.createMessage(passengerId, carpoolId, dto);
    expect(receipt.id).toBe(original.id);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('a reused key cannot change content, while different keys can send the same text', async () => {
    const dto = { tempId: randomUUID(), content: 'Hello' };
    await service.createMessage(driverId, carpoolId, dto);
    await expect(
      service.createMessage(driverId, carpoolId, {
        ...dto,
        content: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await service.createMessage(driverId, carpoolId, {
      ...dto,
      tempId: randomUUID(),
    });
    expect(await prisma.message.count({ where: { carpoolId } })).toBe(2);
  });
  it('the same client key belongs to its sender and conversation', async () => {
    const dto = { tempId: randomUUID(), content: 'Hello' };
    const driver = await service.createMessage(driverId, carpoolId, dto);
    const passenger = await service.createMessage(passengerId, carpoolId, dto);
    expect(driver.id).not.toBe(passenger.id);
    const other = await prisma.carpool.create({
      data: {
        driverId,
        origin: 'Park',
        departureTime: '13:00',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const secondRoom = await service.createMessage(driverId, other.id, dto);
    expect(secondRoom.id).not.toBe(driver.id);
  });
  it('fresh sends still reject non-members, expired chats, and inactive chats', async () => {
    const dto = { tempId: randomUUID(), content: 'Hello' };
    await expect(
      service.createMessage(outsiderId, carpoolId, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.carpool.update({
      where: { id: carpoolId },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.createMessage(driverId, carpoolId, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await prisma.carpool.update({
      where: { id: carpoolId },
      data: { status: 'CANCELLED', expiresAt: new Date(Date.now() + 3600000) },
    });
    await expect(
      service.createMessage(driverId, carpoolId, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await prisma.message.count({ where: { carpoolId } })).toBe(0);
  });
  it('acknowledges committed messages without waiting for broadcast or push', async () => {
    let releaseBroadcast!: () => void;
    let releasePush!: () => void;
    publish.mockReturnValue(
      new Promise((resolve) => {
        releaseBroadcast = resolve;
      }),
    );
    notify.mockReturnValue(
      new Promise((resolve) => {
        releasePush = resolve;
      }),
    );
    try {
      const dto = {
        tempId: randomUUID(),
        content: 'Saved before notification delivery',
      };
      const original = await service.createMessage(driverId, carpoolId, dto);
      expect((await service.createMessage(driverId, carpoolId, dto)).id).toBe(
        original.id,
      );
      expect(await prisma.message.count({ where: { carpoolId } })).toBe(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      releaseBroadcast();
      releasePush();
    }
  });
});

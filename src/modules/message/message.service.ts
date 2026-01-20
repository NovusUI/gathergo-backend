import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMessageDto } from './dtos/create-message.dto';
import { RedisService } from 'src/redis/redis.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { NotificationsService } from '../background-notification/backgroundnotification.service';

@Injectable()
export class MessageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly pubsubService: RedisPubSubService,
    private notificationsService: NotificationsService,
  ) {}

  async getMessages(carpoolId: string, page = 1, limit = 20) {
    return this.prisma.message.findMany({
      where: { carpoolId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: (page - 1) * limit,
      include: {
        sender: { select: { id: true, username: true } },
        readBy: { select: { id: true } },
      },
    });
  }

  async getMessagesCursor(
    carpoolId: string,
    limit = 10,
    before?: string,
    beforeId?: string,
  ) {
    const cursor =
      before && beforeId
        ? { createdAt: new Date(before), id: beforeId }
        : undefined;

    return this.prisma.message.findMany({
      where: { carpoolId },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }, // deterministic ordering when timestamps match
      ],
      take: limit,
      ...(cursor && {
        cursor,
        skip: 1, // IMPORTANT: exclude the cursor row itself
      }),
      include: {
        sender: { select: { id: true, username: true } },
        readBy: { select: { id: true } },
      },
    });
  }

  async createMessage(
    userId: string,
    carpoolId: string,
    dto: CreateMessageDto,
  ) {
    const carpool = await this.prisma.carpool.findUnique({
      where: { id: carpoolId },
      select: {
        id: true,
        expiresAt: true,
        driverId: true,
        passengers: {
          where: { status: 'ACCEPTED' },
          select: { userId: true },
        },
        event: {
          select: {
            title: true,
          },
        },
      },
    });

    if (!carpool) throw new NotFoundException('Carpool not found');

    const hasExpired =
      Date.now() > new Date(carpool.expiresAt).getTime() + 12 * 60 * 60 * 1000;
    if (hasExpired)
      throw new ForbiddenException('Carpool conversation expired');

    const isParticipant =
      carpool.driverId === userId ||
      carpool.passengers.some((p) => p.userId === userId);

    if (!isParticipant)
      throw new ForbiddenException('Not allowed to message in this carpool');

    console.log(dto.content);

    const message = await this.prisma.message.create({
      data: {
        carpoolId,
        senderId: userId,
        content: dto.content,
        tempId: dto.tempId,
      },
      include: {
        sender: { select: { id: true, username: true } },
      },
    });

    await this.pubsubService.publish({
      carpoolId,
      senderId: userId,
      message,
      type: 'chat',
    });

    const participantIds = [
      carpool.driverId,
      ...carpool.passengers.map((p) => p.userId),
    ].filter((id) => id !== userId);

    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    await this.notificationsService.sendMessageNotification({
      userIds: participantIds,
      message,
      carpoolId,
      senderId: userId,
      senderName: sender?.username || '',
      link: '/chat/' + carpoolId,
    });

    return message;
  }

  async getConversationTray(userId: string) {
    const now = new Date();

    const carpools = await this.prisma.carpool.findMany({
      where: {
        OR: [
          { driverId: userId },
          {
            passengers: {
              some: {
                userId,
                status: 'ACCEPTED',
              },
            },
          },
        ],
        expiresAt: {
          gte: new Date(now.getTime() - 12 * 60 * 60 * 1000),
        },
        status: 'ACTIVE',
      },
      include: { event: true },
    });

    const carpoolIds = carpools.map((c) => c.id);

    const latestMessages = await this.prisma.message.findMany({
      where: { carpoolId: { in: carpoolIds } },
      orderBy: [{ carpoolId: 'asc' }, { createdAt: 'desc' }],
    });

    const messagesByCarpool = new Map<string, (typeof latestMessages)[0]>();
    for (const msg of latestMessages) {
      if (!messagesByCarpool.has(msg.carpoolId)) {
        messagesByCarpool.set(msg.carpoolId, msg);
      }
    }

    const senderIds = [
      ...new Set([...messagesByCarpool.values()].map((m) => m.senderId)),
    ];
    const senders = await this.prisma.user.findMany({
      where: { id: { in: senderIds } },
      select: { id: true, username: true, profilePicUrlTN: true },
    });
    const senderMap = new Map(senders.map((s) => [s.id, s]));

    const redisKeys = carpoolIds.map((id) => `message:unread:${userId}:${id}`);
    const unreadValues = await this.redisService.client.mget(redisKeys);

    return carpools.map((carpool, index) => {
      const msg = messagesByCarpool.get(carpool.id);
      return {
        carpool,
        event: carpool.event,
        lastMessage: msg?.content ?? null,
        lastMessageAt: msg?.createdAt ?? null,
        sender: msg ? senderMap.get(msg.senderId) : null,
        unreadCount: Number(unreadValues[index] ?? 0),
      };
    });
  }

  async getTotalUnreadCount(userId: string) {
    const keys = await this.redisService.client.keys(
      `message:unread:${userId}:*`,
    );
    if (!keys.length) return 0;

    const counts = await this.redisService.client.mget(keys);
    return counts.reduce((acc, c) => acc + Number(c ?? 0), 0);
  }

  async getUnreadByCarpool(userId: string) {
    const keys = await this.redisService.client.keys(
      `message:unread:${userId}:*`,
    );
    const result: Record<string, number> = {};

    for (const key of keys) {
      const [, , , carpoolId] = key.split(':');
      const count = await this.redisService.client.get(key);
      result[carpoolId] = Number(count ?? 0);
    }

    return result;
  }

  async markMessagesAsRead(userId: string, carpoolId: string): Promise<void> {
    const unreadMessages = await this.prisma.message.findMany({
      where: {
        carpoolId,
        readBy: {
          none: { id: userId },
        },
      },
      select: { id: true },
    });

    const messageIds = unreadMessages.map((msg) => ({ id: msg.id }));

    if (messageIds.length === 0) return;

    await Promise.all(
      messageIds.map((msg) =>
        this.prisma.message.update({
          where: { id: msg.id },
          data: {
            readBy: {
              connect: { id: userId },
            },
          },
        }),
      ),
    );
    await this.redisService.client.set(
      `message:unread:${userId}:${carpoolId}`,
      0,
    );
  }
}

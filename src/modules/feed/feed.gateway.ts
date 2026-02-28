import {
  SubscribeMessage,
  WebSocketGateway,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { FeedService } from './feed.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { BaseGateway } from 'src/common/base.gateway';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
@UseGuards(WsJwtGuard)
export class FeedGateway extends BaseGateway {
  protected logger: Logger = new Logger('FeedGateway');

  constructor(
    private readonly feedService: FeedService,
    pubsubService: RedisPubSubService,
  ) {
    super(pubsubService);

    // Subscribe to feed updates
    // this.pubsubService.subscribe('feed', async (data) => {
    //   const { eventId, feed } = data;
    //   this.server.to(`event:${eventId}:feed`).emit('newFeed', feed);
    // });
  }

  @SubscribeMessage('joinEventFeed')
  async handleJoinEventFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; limit?: number },
  ) {
    const { eventId, limit = 20 } = data;
    const userId = client.handshake.auth.userId;

    // const hasAccess = await this.validateEventAccess(client, eventId);
    // if (!hasAccess) return;

    client.join(`event:${eventId}:feed`);

    if (userId) {
      client.join(`user:${userId}:feeds`);
    }

    const feeds = await this.feedService.getFeedsWithCursor(
      eventId,
      limit,
      undefined,
      userId,
    );

    this.logger.log(`Client ${client.id} joined event feed:${eventId}`);

    client.emit('feedHistory', {
      eventId,
      feeds,
      hasMore: feeds.length === limit,
    });
  }

  @SubscribeMessage('leaveEventFeed')
  handleLeaveEventFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    client.leave(`event:${data.eventId}:feed`);
    this.logger.log(`Client ${client.id} left event feed:${data.eventId}`);
  }

  @SubscribeMessage('loadMoreFeeds')
  async handleLoadMoreFeeds(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      eventId: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    const { eventId, cursor, limit = 20 } = data;
    const userId = client.handshake.auth.userId;

    // const hasAccess = await this.validateEventAccess(client, eventId);
    // if (!hasAccess) return;

    const feeds = await this.feedService.getFeedsWithCursor(
      eventId,
      limit,
      cursor,
      userId,
    );

    const hasMore = feeds.length === limit;

    client.emit('feedHistory', {
      eventId,
      feeds,
      hasMore,
    });
  }

  @SubscribeMessage('hideFeed')
  async handleHideFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { feedId: string },
  ) {
    const userId = client.handshake.auth.userId;

    if (!userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const result = await this.feedService.hideFeed(data.feedId, userId);

    client.emit('feedHidden', result);
  }

  @SubscribeMessage('getPinnedFeeds')
  async handleGetPinnedFeeds(@ConnectedSocket() client: Socket) {
    const userId = client.handshake.auth.userId;

    if (!userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    const pinnedFeeds = await this.feedService.getUserPinnedFeeds(userId);

    client.emit('pinnedFeeds', pinnedFeeds);
  }

  @SubscribeMessage('getFrenzyHistory')
  async handleGetFrenzyHistory(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; limit?: number; cursor?: string },
  ) {
    const { eventId, limit = 10, cursor } = data;

    // const hasAccess = await this.validateEventAccess(client, eventId);
    // if (!hasAccess) return;

    const frenzies = await this.feedService.getFrenzyHistory(
      eventId,
      limit,
      cursor,
    );

    client.emit('frenzyHistory', {
      eventId,
      frenzies,
      hasMore: frenzies.length === limit,
    });
  }

  @SubscribeMessage('subscribeToPinnedUpdates')
  async handleSubscribeToPinnedUpdates(@ConnectedSocket() client: Socket) {
    const userId = client.handshake.auth.userId;

    if (!userId) {
      client.emit('error', { message: 'Authentication required' });
      return;
    }

    client.join(`user:${userId}:pinned-feeds`);
  }

  //   private async validateEventAccess(
  //     client: Socket,
  //     eventId: string,
  //   ): Promise<boolean> {
  //     try {
  //       const userId = client.handshake.auth.userId;

  //       const event = await this.prisma.event.findUnique({
  //         where: { id: eventId },
  //         select: {
  //           id: true,

  //           creatorId: true,
  //         },
  //       });

  //       if (!event) {
  //         client.emit('error', { message: 'Event not found' });
  //         return false;
  //       }

  //       // Public events are accessible to anyone
  //       //   if (event.isPublic === true) {
  //       //     return true;
  //       //   }

  //       // For private events, check if user is creator or participant
  //       //   if (!userId) {
  //       //     client.emit('error', { message: 'Authentication required for private events' });
  //       //     return false;
  //       //   }

  //       // Check if user is creator
  //       if (event.creatorId === userId) {
  //         return true;
  //       }

  //       // Check if user has ticket
  //       const hasTicket = await this.prisma.ticket.findFirst({
  //         where: {
  //           event: { id: eventId },
  //           userId,
  //           status: 'active',
  //         },
  //       });

  //       // Check if user is registered
  //       const hasRegistration = await this.prisma.registration.findFirst({
  //         where: {
  //           eventId,
  //           userId,
  //           status: 'active',
  //         },
  //       });

  //       // Check if user has donated
  //       const hasDonated = await this.prisma.donation.findFirst({
  //         where: {
  //           eventId,
  //           userId,
  //           status: 'active',
  //         },
  //       });

  //       if (hasTicket || hasRegistration || hasDonated) {
  //         return true;
  //       }

  //       client.emit('error', { message: 'Access denied' });
  //       return false;
  //     } catch (error) {
  //       this.logger.error(`Error validating event access: ${error.message}`);
  //       client.emit('error', { message: 'Internal server error' });
  //       return false;
  //     }
  //   }

  async pushPinnedFeedUpdate(userId: string, feed: any) {

  
    this.server
      .to(`user:${userId}:pinned-feeds`)
      .emit('pinnedFeedUpdate', feed);
  }

  async pushEventFeedUpdate(eventId: string, feed: any) {
    this.server.to(`event:${eventId}:feed`).emit('newFeed', feed);
  }
}

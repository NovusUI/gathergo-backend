// post.gateway.ts
import {
  WebSocketGateway,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { PostService } from './post.service';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';
import { BaseGateway } from 'src/common/base.gateway';

@WebSocketGateway({ cors: { origin: '*' } })
@UseGuards(WsJwtGuard)
export class PostGateway extends BaseGateway {
  protected logger = new Logger('PostGateway');

  constructor(
    private readonly postService: PostService,
    pubsubService: RedisPubSubService,
  ) {
    super(pubsubService);
  }

  // No need to override handleConnection - base class handles user room joining automatically

  @SubscribeMessage('joinEventFeed')
  async handleJoinEventFeed(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    client.join(`event:${data.eventId}`);
    this.logger.log(`Client ${client.id} joined event:${data.eventId}`);
  }

  // ... (all other methods remain the same as previous refactor)
  @SubscribeMessage('fetchNewPosts')
  async handleFetchNewPosts(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; after: Date },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    const posts = await this.postService.getPostsAfter(
      data.eventId,
      userId,
      data.after,
    );
    client.emit('newPosts', { posts });
  }

  @SubscribeMessage('loadOlderPosts')
  async handleLoadOlderPosts(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; before: Date; limit?: number },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    const posts = await this.postService.getPostsBefore(
      data.eventId,
      data.before,
      userId,
      data.limit ?? 20,
    );
    client.emit('olderPosts', { posts });
  }

  @SubscribeMessage('createPost')
  async handleCreatePost(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { eventId: string; payload: any },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    await this.postService.create(userId, data.payload);
  }

  @SubscribeMessage('addComment')
  async handleAddComment(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string; content: string },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    await this.postService.addComment(data.postId, userId, data.content);
  }

  @SubscribeMessage('toggleLike')
  async handleToggleLike(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    await this.postService.toggleLike(data.postId, userId);
  }

  @SubscribeMessage('deleteComment')
  async handleDeleteComment(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { commentId: string; postId: string },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    await this.postService.deleteComment(data.commentId, userId);
  }

  @SubscribeMessage('joinPost')
  async handleJoinPost(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string },
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    client.join(`post:${data.postId}`);
    this.logger.log(`Client ${client.id} joined post thread: ${data.postId}`);
  }

  @SubscribeMessage('getLatestComments')
  async handleGetLatestComments(
    @MessageBody() data: { postId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    try {
      const comments = await this.postService.getLatestComments(data.postId);
      client.emit('latestComments', { postId: data.postId, comments });
    } catch (err) {
      this.emitError(client, 'Failed to load comments', err);
    }
  }

  @SubscribeMessage('getCommentsBefore')
  async handleGetCommentsBefore(
    @MessageBody() data: { postId: string; beforeDate: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = this.validateUser(client);
    if (!userId) return;

    try {
      const comments = await this.postService.getCommentsBefore(
        data.postId,
        new Date(data.beforeDate),
      );
      client.emit('moreComments', { postId: data.postId, comments });
    } catch (err) {
      this.emitError(client, 'Failed to load more comments', err);
    }
  }
}

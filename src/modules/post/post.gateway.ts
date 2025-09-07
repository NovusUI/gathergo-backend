// src/modules/post/post.gateway.ts
import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    ConnectedSocket,
    MessageBody,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
  } from '@nestjs/websockets';
  import { Server, Socket } from 'socket.io';
  import { Logger, UseGuards } from '@nestjs/common';
  import { PostService } from './post.service';
  import { SocketAuthMiddleware } from 'src/common/middleware/ws.mw';
import { WsJwtGuard } from 'src/common/guards/ws-jwt.guard';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';


  
@WebSocketGateway({ 
  cors: {
      origin: '*',
    },
})
  @UseGuards(WsJwtGuard)
  export class PostGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private logger = new Logger('PostGateway');
  
    constructor(
      private readonly postService: PostService,
      private readonly pubsubService: RedisPubSubService

    ) {}
  
    afterInit(server: Server) {
      this.server = server;
    
      // Apply your custom auth middleware globally to all socket connections
      this.server.use(SocketAuthMiddleware() as any);
    
      // Set the socket server on Redis pubsub service
      this.pubsubService.setSocketServer(server);
    
      this.logger.log('Notification Gateway initialized and middleware set');
    }
    
  
    handleConnection(client: Socket) {
      this.logger.log(`Client ${client.id} connected`);
    }
  
    handleDisconnect(client: Socket) {
      this.logger.log(`Client ${client.id} disconnected`);
    }
  
    @SubscribeMessage('joinEventFeed')
    async handleJoinEventFeed(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { eventId: string }
    ) {
        const userId = client.handshake.auth.user.sub;
      if (!userId) return;
      client.join(`event:${data.eventId}`);
      this.logger.log(`Client ${client.id} joined event:${data.eventId}`);
    }
  
    @SubscribeMessage('fetchNewPosts')
    async handleFetchNewPosts(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { eventId: string; after: Date },
   
    ) {
        const userId = client.handshake.auth.user.sub;
      if (!userId) return;
      const posts = await this.postService.getPostsAfter(data.eventId,userId, data.after);
      client.emit('newPosts', { posts });
    }
  
    @SubscribeMessage('loadOlderPosts')
    async handleLoadOlderPosts(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: { eventId: string; before: Date; limit?: number },
   
    ) {
        const userId = client.handshake.auth.user.sub;
      if (!userId) return;
      const posts = await this.postService.getPostsBefore(data.eventId, data.before,userId ,data.limit ?? 20);
      client.emit('olderPosts', { posts });
    }
  
    @SubscribeMessage('createPost')
    async handleCreatePost(
      @ConnectedSocket() client: Socket,
      @MessageBody() data: {eventId: string; payload: any }
    ) {
        const userId = client.handshake.auth.user.sub;
      if (!userId) return;
      const post = await this.postService.create(userId, data.payload);
  
  
    }

    @SubscribeMessage('addComment')
  async handleAddComment(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string;  content: string }
  ) {
    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
    const comment = await this.postService.addComment(data.postId, userId, data.content);
    //this.server.to(`event:${comment.postId}`).emit('newComment', comment);
  }

  @SubscribeMessage('toggleLike')
  async handleToggleLike(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string;  }
  ) {

    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
    const result = await this.postService.toggleLike(data.postId, userId);
  }

  @SubscribeMessage('deleteComment')
  async handleDeleteComment(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { commentId: string;  postId: string }
  ) {
    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
    await this.postService.deleteComment(data.commentId, userId);
  }

  @SubscribeMessage('joinPost')
  async handleJoinPost(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { postId: string }
  ) {
    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
    client.join(`post:${data.postId}`);
    console.log(`Client ${client.id} joined post thread: ${data.postId}`);
  }

  @SubscribeMessage('getLatestComments')
async handleGetLatestComments(
  @MessageBody() data: { postId: string },
  @ConnectedSocket() client: Socket,
) {
    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
  try {
    const comments = await this.postService.getLatestComments(data.postId);
    client.emit('latestComments', { postId: data.postId, comments });
  } catch (err) {
    client.emit('error', { message: 'Failed to load comments' });
  }
}

@SubscribeMessage('getCommentsBefore')
async handleGetCommentsBefore(
  @MessageBody() data: { postId: string; beforeDate: string },
  @ConnectedSocket() client: Socket,
) {
    const userId = client.handshake.auth.user.sub;
      if (!userId) return;
  try {
    const comments = await this.postService.getCommentsBefore(
      data.postId,
      new Date(data.beforeDate),
    );
    client.emit('moreComments', { postId: data.postId, comments });
  } catch (err) {
    client.emit('error', { message: 'Failed to load more comments' });
  }
}

  }
  
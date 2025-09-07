import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreatePostDto } from './dtos/create-post.dto';
import { UpdatePostDto } from './dtos/update-post.dto';
import { RedisService } from 'src/redis/redis.service';
import { RedisPubSubService } from 'src/redis/redis.pubsub.service';


@Injectable()
export class PostService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private redisPubSub: RedisPubSubService,
    ) {}

  async create(userId: string, dto: CreatePostDto) {
    // Optional: validate posting rights based on event settings
    const post = await this.prisma.post.create({
      data: {
        ...dto,
        creatorId: userId,
        type: dto.type,
        mediaUrls: dto.mediaUrls ?? [],
        hashtags: {
            connectOrCreate: dto.hashtags?.map((tag) => ({
              where: {  tag },
              create: {  tag },
            })) ?? [],
        },
        mentions: {
            connect: dto.taggedUserIds?.map((id) => ({ id })) ?? [],
        },
      },
      include: { hashtags: true, mentions: true },
    });

    await this.redis.client.incr(`trend:event:${dto.eventId}`);
  dto.hashtags?.forEach(async (tag) => {
    await this.redis.client.incr(`trend:hashtag:${tag}`);
  });
    // TODO: Trigger pubsub if needed
    await this.publishPost(post, 'post:new');
    return post;
  }

  async findByEvent(eventId: string) {
    return this.prisma.post.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      include: {
        creator: true,
        event: true,
        likes: true,
        comments: true,
      },
    });
  }

  async update(id: string, userId: string, dto: UpdatePostDto) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || post.creatorId !== userId) throw new ForbiddenException();
  
    const updated = await this.prisma.post.update({
      where: { id },
      data: {
        content: dto.content,
        type: dto.type,
        mediaUrls: dto.mediaUrls,
        communityId: dto.communityId,
        hashtags: dto.hashtags
          ? {
              connectOrCreate: dto.hashtags.map((tag) => ({
                where: { tag },
                create: { tag },
              })),
            }
          : undefined,
        mentions: dto.taggedUserIds
          ? {
              set: dto.taggedUserIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        creator: true,
        hashtags: true,
        mentions: true,
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: true, mentions: true },
        },
        _count: { select: { likes: true } },
      },
    });
  
    await this.publishPost(updated, 'post:updated');
    return updated;
  }
  
  

  async delete(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        creator: true,
        hashtags: true,
        mentions: true,
      },
    });
    if (!post || post.creatorId !== userId) throw new ForbiddenException();
  
    const deleted = await this.prisma.post.delete({
      where: { id },
    });
  
    await this.publishPost(post, 'post:deleted'); // Send pre-deletion snapshot
    return deleted;
  }
  

  async pinPost(id: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: { creator: true },
    });
    if (!post || post.creatorId !== userId) throw new ForbiddenException();
  
    const updated = await this.prisma.post.update({
      where: { id },
      data: { isPinned: true },
      include: {
        creator: true,
        hashtags: true,
        mentions: true,
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: true, mentions: true },
        },
        _count: { select: { likes: true } },
      },
    });
  
    // ✅ Publish pinned post
    await this.publishPost(updated, 'post:pinned');
  
    return updated;
  }
  

  async getPostsAfter(eventId: string, userId: string, afterDate?: Date, limit = 20) {
    const where: any = { eventId };
    if (afterDate) {
      where.createdAt = { gt: afterDate };
    }
  
    const posts = await this.prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' }, // 👈 NEWEST FIRST
      take: limit,
      include: {
        creator: true,
        hashtags: true,
        mentions: true,
        _count: { select: { likes: true } },
        likes: {
            where: { userId }, // filter likes to only those by current user
            select: { id: true }, // we just need to know if it exists
          },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: true, mentions: true },
        },
      },
    });
  
    // const likedPosts = await this.prisma.like.findMany({
    //   where: {
    //     userId,
    //     postId: { in: posts.map((p) => p.id) },
    //   },
    //   select: { postId: true },
    // });
  
    // const likedPostIds = new Set(likedPosts.map((l) => l.postId));
  
    return posts.map((post) => ({
      ...post,
      isLikedByUser: post.likes.length > 0,
      likes:undefined
    }));
  }
  
  
  
//   async getPostsBefore(eventId: string, beforeDate: Date, userId: string, limit = 20) {
//     const posts = await this.prisma.post.findMany({
//       where: {
//         eventId,
//         createdAt: { lt: beforeDate },
//       },
//       orderBy: { createdAt: 'desc' },
//       take: limit,
//       include: {
//         creator: true,
//         hashtags: true,
//         mentions: true,
//         _count: { select: { likes: true } },
//         comments: {
//           orderBy: { createdAt: 'desc' },
//           take: 5,
//           include: { author: true, mentions: true },
//         },
//       },
//     });
  
//     const likedPosts = await this.prisma.like.findMany({
//       where: {
//         userId,
//         postId: { in: posts.map((p) => p.id) },
//       },
//       select: { postId: true },
//     });
  
//     const likedPostIds = new Set(likedPosts.map((l) => l.postId));
  
//     return posts.map((post) => ({
//       ...post,
//       isLikedByUser: likedPostIds.has(post.id),
//     }));
//   }
  

async getPostsBefore(eventId: string, beforeDate: Date, userId: string, limit = 20) {
    const posts = await this.prisma.post.findMany({
      where: {
        eventId,
        createdAt: { lt: beforeDate },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        creator: true,
        hashtags: true,
        mentions: true,
        _count: { select: { likes: true } },
        likes: {
          where: { userId }, // filter likes to only those by current user
          select: { id: true }, // we just need to know if it exists
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { author: true, mentions: true },
        },
      },
    });
  
    return posts.map((post) => ({
      ...post,
      isLikedByUser: post.likes.length > 0,
      likes: undefined, // optionally strip the filtered likes array if not needed in frontend
    }));
  }
  
  

  async addComment(postId: string, userId: string, content: string) {
    const comment = await this.prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        content,
      },
      include: { author: true, mentions: true },
    });
  
    await this.publishComment(comment, 'comment:new');
    return comment;
  }
  

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      include: { author: true },
    });
    if (!comment || comment.authorId !== userId) throw new Error('Unauthorized or not found');
  
    const deleted = await this.prisma.comment.delete({
      where: { id: commentId },
    });
  
    await this.publishComment(comment, 'comment:deleted');
    return deleted;
  }
  
  
  async toggleLike(postId: string, userId: string) {
    const existing = await this.prisma.like.findUnique({
      where: {
        postId_userId: {
          postId,
          userId,
        },
      },
    });
  
    if (existing) {
      await this.prisma.like.delete({
        where: { postId_userId: { postId, userId } },
      });
      return { liked: false };
    } else {
      await this.prisma.like.create({
        data: { postId, userId },
      });
      return { liked: true };
    }
  }

  async getLatestComments(postId: string, limit = 40) {
    return this.prisma.comment.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        author: true,
        mentions: true,
      },
    });
  }

  async getCommentsBefore(postId: string, beforeDate: Date, limit = 20) {
    return this.prisma.comment.findMany({
      where: {
        postId,
        createdAt: { lt: beforeDate },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        author: true,
        mentions: true,
      },
    });
  }
  

  private async publishPost(post: any, type: 'post:new' | 'post:pinned' | 'post:deleted' | 'post:updated') {
    await this.redisPubSub.publishPost(post, type);
  }
  
  private async publishComment(comment: any, type: 'comment:new' | 'comment:deleted') {
    await this.redisPubSub.publishComment(comment, type);
  }
  
  
}


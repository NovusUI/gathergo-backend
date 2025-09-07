import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FollowUserDto } from './dto/follow-user.dto';
import { FollowCommunityDto } from '../community-follow/dto/follow-community.dto';

@Injectable()
export class UserFollowService {
  constructor(private prisma: PrismaService) {}

  async followUser(followerId: string, dto: FollowUserDto) {
    // Check if already following
    const existing = await this.prisma.userFollow.findUnique({
      where: {
        followerId_followingId: {
          followerId,
          followingId: dto.followingId,
        },
      },
    });
  
    if (existing) {
      return { message: 'Already following this user' };
    }
  
    // Create follow record
    await this.prisma.userFollow.create({
      data: {
        followerId,
        followingId: dto.followingId,
      },
    });
  
    // Increment counts
    // await this.prisma.user.update({
    //   where: { id: followerId },
    //   data: { followingCount: { increment: 1 } },
    // });
  
    // await this.prisma.user.update({
    //   where: { id: dto.followingId },
    //   data: { followersCount: { increment: 1 } },
    // });
  
    return { message: 'Followed user successfully' };
  }
  

  async unfollowUser(followerId: string, followingId: string) {
    // Delete follow record
    await this.prisma.userFollow.delete({
      where: {
        followerId_followingId: {
          followerId,
          followingId,
        },
      },
    });
  
    // Decrement counts
    // await this.prisma.user.update({
    //   where: { id: followerId },
    //   data: { followingCount: { decrement: 1 } },
    // });
  
    // await this.prisma.user.update({
    //   where: { id: followingId },
    //   data: { followersCount: { decrement: 1 } },
    // });
  
    return { message: 'Unfollowed user successfully' };
  }
  



  async getFollowers(userId: string) {
    return this.prisma.userFollow.findMany({
      where: { followingId: userId },
      include: { follower: true },
    });
  }

  async getFollowing(userId: string) {
    return this.prisma.userFollow.findMany({
      where: { followerId: userId },
      include: { following: true },
    });
  }
}

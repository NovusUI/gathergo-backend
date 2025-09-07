import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FollowCommunityDto } from './dto/follow-community.dto';

@Injectable()
export class CommunityFollowService {
  constructor(private prisma: PrismaService) {}

  async followCommunity(userId: string, dto: FollowCommunityDto) {
    const existing = await this.prisma.communityFollow.findUnique({
      where: {
        userId_communityId: {
          userId,
          communityId: dto.communityId,
        },
      },
    });

    if (existing) {
      return { message: 'Already following this community' };
    }

    return this.prisma.communityFollow.create({
      data: {
        userId,
        communityId: dto.communityId,
      },
    });
  }

  async unfollowCommunity(userId: string, communityId: string) {
    return this.prisma.communityFollow.delete({
      where: {
        userId_communityId: {
          userId,
          communityId,
        },
      },
    });
  }
}

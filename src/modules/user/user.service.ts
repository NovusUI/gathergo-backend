import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CompleteProfileDto } from './dto/complete-profile-dto';
import { EditBioDto } from './dto/edit-bio-dto';
import { MediaService } from '../media/media.service';


@Injectable()
export class UserService {
    constructor(private prisma: PrismaService,
                private mediaService: MediaService
      ) {}

    async completeProfile(userId: string, dto: CompleteProfileDto) {
      // Check if username is already taken
      const usernameExists = await this.prisma.user.findUnique({
        where: { username: dto.username.toLowerCase().trim() },
      });
      if (usernameExists) {
        throw new UnauthorizedException('Username already taken');
      }
  
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          username: dto.username,
          profilePicUrl: dto.profilePicUrl,
          phoneNumber: dto.phoneNumber,
          birthDate: dto.birthDate  && new Date(dto.birthDate),
          nationality: dto.nationality,
          gender: dto.gender,
          isProfileComplete: true,
        },
      });
    }

    async editUserBio(userId: string, dto: EditBioDto) {
     
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          bio: dto.bio,

        },
      })
    }


  async getAllUsers() {
    return this.prisma.user.findMany();
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }


  



  async getPublicProfile(targetUserId: string, viewerId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      include: {
        _count: {
          select: {
            followedBy: true,
            following: true,
            eventsCreated: true,
          },
        },
        communityFollows: {
          include: {
            community: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if viewer follows this user
    let isFollowing = false;
    if (viewerId) {
      const follow = await this.prisma.userFollow.findFirst({
        where: {
          followerId: viewerId,
          followingId: targetUserId,
        },
      });
      isFollowing = !!follow;
    }

    // Get community suggestions (currently simple, can add similarity logic later)
    const similarCommunities = await this.prisma.community.findMany({
      take: 5,
    });

    return {
      id: user.id,
      name: user.username,
      bio: user.bio,
      followersCount: user._count.followedBy,
      followingCount: user._count.following,
      isFollowing,
      communities: user.communityFollows.map((cf) => cf.community),
      similarCommunities,
      profilePicUrl: user.profilePicUrl

    };
  }

  async updateProfilePicture(userId: string, file: Express.Multer.File) {
    const { url, thumbnailUrl } = await this.mediaService.uploadFile(file, `users/${userId}`);
  

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        profilePicUrl:url,
        profilePicUrlTN: thumbnailUrl
      },
    })
  
    return { url, thumbnailUrl };
  }


}



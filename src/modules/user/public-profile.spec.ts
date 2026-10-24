import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { UserService } from './user.service';

describe('public profile summary', () => {
  it('returns the event and follow counts already selected for the profile', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: 'ada',
          bio: 'Hello',
          profilePicUrl: null,
          _count: { eventsCreated: 3, followedBy: 12, following: 8 },
          communityFollows: [],
        }),
      },
      community: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    const profile = await module.get(UserService).getPublicProfile('user-1');
    expect(profile).toMatchObject({
      eventsCount: 3,
      followersCount: 12,
      followingCount: 8,
    });
    await module.close();
  });
});

import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { MediaService } from '../media/media.service';
import { UserService } from './user.service';

describe('Profile completion', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn<Promise<{ id: string }>, [Prisma.UserUpdateArgs]>(),
    },
  };
  let service: UserService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.update.mockResolvedValue({ id: 'user-1' });
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    service = module.get(UserService);
  });

  it('saves the name, username, and birthday before completing the profile', async () => {
    const result = await service.completeProfile('user-1', {
      fullName: 'Ada Example',
      username: 'ada_example',
      birthDate: '2000-10-17',
    });

    expect(result).toEqual({ id: 'user-1' });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({
      fullName: 'Ada Example',
      username: 'ada_example',
      birthDate: new Date('2000-10-17'),
      isProfileComplete: true,
    });
  });

  it('does not complete the profile when the username is unavailable', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'another-user' });

    await expect(
      service.completeProfile('user-1', {
        fullName: 'Ada Example',
        username: 'ada_example',
        birthDate: '2000-10-17',
      }),
    ).rejects.toThrow('Username already taken');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

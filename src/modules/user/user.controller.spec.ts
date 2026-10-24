import { Test } from '@nestjs/testing';
import { BadgeService } from '../badge/badge.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController public badges', () => {
  it('adds only the badge service public projection to a public profile', async () => {
    const profile = { id: 'target-user', name: 'Ada', bio: 'Hello' };
    const badges = [{ code: 'FIRST_GATHER', name: 'First Gather' }];
    const users = { getPublicProfile: jest.fn().mockResolvedValue(profile) };
    const badgeService = { getPublic: jest.fn().mockResolvedValue(badges) };
    const module = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: users },
        { provide: BadgeService, useValue: badgeService },
      ],
    }).compile();
    expect(
      await module
        .get(UserController)
        .getPublicProfile('target-user', 'viewer'),
    ).toEqual({ ...profile, badges });
    expect(users.getPublicProfile).toHaveBeenCalledWith(
      'target-user',
      'viewer',
    );
    expect(badgeService.getPublic).toHaveBeenCalledWith('target-user');
    await module.close();
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DashboardRole } from '@prisma/client';
import {
  CreateDashboardUserDto,
  DashboardLoginDto,
  UpdateDashboardUserDto,
} from './dashboard-auth.dto';

describe('Dashboard credentials validation', () => {
  const input = {
    username: ' Ops.Admin ',
    fullName: ' Operations Admin ',
    role: DashboardRole.ADMIN,
    password: 'Synthetic-password!',
  };
  it('normalizes usernames and names without changing passwords', async () => {
    const dto = plainToInstance(CreateDashboardUserDto, input);
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.username).toBe('ops.admin');
    expect(dto.fullName).toBe('Operations Admin');
    expect(dto.password).toBe(input.password);
  });
  it('rejects short or bcrypt-truncated passwords, invalid roles and invalid usernames', async () => {
    for (const change of [
      { password: 'short' },
      { password: 'a'.repeat(73) },
      { password: '🔒'.repeat(19) },
      { role: 'OWNER' },
      { username: 'has spaces' },
    ]) {
      expect(
        (
          await validate(
            plainToInstance(CreateDashboardUserDto, { ...input, ...change }),
          )
        ).length,
      ).toBeGreaterThan(0);
    }
  });
  it('does not coerce numeric usernames/passwords into valid strings under implicit conversion', async () => {
    for (const data of [
      { username: 12345, password: input.password },
      { username: 'reader', password: 123456789012 },
    ]) {
      const dto = plainToInstance(DashboardLoginDto, data, {
        enableImplicitConversion: true,
      });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
  it('rejects explicit null values in account edits', async () => {
    for (const data of [{ role: null }, { status: null }, { fullName: null }])
      expect(
        (await validate(plainToInstance(UpdateDashboardUserDto, data))).length,
      ).toBeGreaterThan(0);
    expect(
      await validate(plainToInstance(UpdateDashboardUserDto, {})),
    ).toHaveLength(0);
  });
});

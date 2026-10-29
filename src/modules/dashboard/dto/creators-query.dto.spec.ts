import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatorsQueryDto } from './creators-query.dto';

describe('CreatorsQueryDto', () => {
  it('defaults pagination and trims a creator search', async () => {
    const dto = plainToInstance(CreatorsQueryDto, {
      search: ' host@example.test ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
    expect(dto.search).toBe('host@example.test');
  });
  it.each([
    { page: '0' },
    { page: '1.5' },
    { pageSize: '51' },
    { search: 'x'.repeat(151) },
    { kycStatus: 'NOT_A_STATUS' },
    { payoutStatus: 'NOT_A_STATUS' },
  ])('rejects invalid filters and pagination: %p', async (query) => {
    expect(
      (await validate(plainToInstance(CreatorsQueryDto, query))).length,
    ).toBeGreaterThan(0);
  });
});

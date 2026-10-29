import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  InternalEventsQueryDto,
  UpdateInternalEventDto,
} from './internal-events.dto';

describe('Platform event DTOs', () => {
  it('defaults pagination and accepts platform filters', async () => {
    const dto = plainToInstance(InternalEventsQueryDto, {
      creatorId: 'host',
      registrationType: 'volunteer',
      status: 'ENDED',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(20);
  });
  it.each([
    { page: '0' },
    { page: '1.5' },
    { pageSize: '51' },
    { registrationType: 'BAD' },
    { status: 'BAD' },
    { search: 'x'.repeat(151) },
  ])('rejects invalid query values %p', async (query) => {
    expect(
      (await validate(plainToInstance(InternalEventsQueryDto, query))).length,
    ).toBeGreaterThan(0);
  });
  it('allows historical schedules and clearing a description while requiring the reviewed version', async () => {
    const dto = plainToInstance(UpdateInternalEventDto, {
      expectedUpdatedAt: '2020-01-01T00:00:00Z',
      title: ' Past event ',
      description: '',
      startDate: '2020-01-01T00:00:00Z',
      endDate: '2020-01-02T00:00:00Z',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.title).toBe('Past event');
    expect(
      (
        await validate(
          plainToInstance(UpdateInternalEventDto, { title: 'Event' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it.each([
    { title: null },
    { title: '   ' },
    { startDate: null },
    { endDate: 'BAD' },
    { description: null },
  ])('rejects invalid editable fields %p', async (fields) => {
    expect(
      (
        await validate(
          plainToInstance(UpdateInternalEventDto, {
            expectedUpdatedAt: '2020-01-01T00:00:00Z',
            ...fields,
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});

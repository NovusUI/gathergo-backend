import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEventDto } from '../../event/dto/create-event.dto';
import { RescheduleCollectionDto, UpdateCollectionDto } from './collection.dto';

describe('collection request validation', () => {
  const expectedUpdatedAt = '2035-01-01T10:00:00Z';
  it.each(['OPEN', 'PAUSED', 'CLOSED'])(
    'accepts the %s operation with a reviewed revision',
    async (status) => {
      expect(
        await validate(
          plainToInstance(UpdateCollectionDto, { status, expectedUpdatedAt }),
        ),
      ).toHaveLength(0);
    },
  );
  it.each(['NOT_STARTED', 'open', '', null])(
    'rejects unsupported operation %s',
    async (status) => {
      expect(
        await validate(
          plainToInstance(UpdateCollectionDto, { status, expectedUpdatedAt }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it('requires valid dates and a revision when rescheduling', async () => {
    expect(
      await validate(
        plainToInstance(RescheduleCollectionDto, {
          startDate: '2035-01-02T10:00:00Z',
          expectedUpdatedAt,
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(RescheduleCollectionDto, { startDate: 'tomorrow' }),
      ),
    ).not.toHaveLength(0);
  });
  it('validates the IANA timezone saved on creation', async () => {
    const valid = await validate(
      plainToInstance(CreateEventDto, { foodBankTimeZone: 'Africa/Lagos' }),
      { skipMissingProperties: true },
    );
    expect(
      valid.find((issue) => issue.property === 'foodBankTimeZone'),
    ).toBeUndefined();
    const invalid = await validate(
      plainToInstance(CreateEventDto, { foodBankTimeZone: 'Invalid/Zone' }),
      { skipMissingProperties: true },
    );
    expect(
      invalid.find((issue) => issue.property === 'foodBankTimeZone'),
    ).toBeDefined();
  });
});

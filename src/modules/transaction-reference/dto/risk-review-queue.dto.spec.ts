import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RiskStatus } from '@prisma/client';
import { RiskReviewQueueQueryDto } from './risk-review-queue.dto';

describe('Payment risk queue filters', () => {
  it.each(Object.values(RiskStatus))(
    'accepts the stored risk state %s',
    async (riskStatus) => {
      const dto = plainToInstance(RiskReviewQueueQueryDto, { riskStatus });
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('rejects unsupported risk states', async () => {
    const dto = plainToInstance(RiskReviewQueueQueryDto, {
      riskStatus: 'FLAGGED',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it.each(['true', 'false'])(
    'preserves reviewed=%s with the HTTP validation pipe conversion',
    async (reviewed) => {
      const dto = plainToInstance(
        RiskReviewQueueQueryDto,
        { reviewed },
        {
          enableImplicitConversion: true,
        },
      );
      expect(dto.reviewed).toBe(reviewed === 'true');
      expect(await validate(dto)).toHaveLength(0);
    },
  );

  it('rejects invalid review filters', async () => {
    const dto = plainToInstance(
      RiskReviewQueueQueryDto,
      { reviewed: 'unreviewed' },
      {
        enableImplicitConversion: true,
      },
    );
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

import { validate } from 'class-validator';
import { BatchReviewTransactionRiskDto } from './batch-review-transaction-risk.dto';
import { ReviewableRiskStatusDto } from './review-transaction-risk.dto';

describe('BatchReviewTransactionRiskDto', () => {
  it.each([
    { transactionIds: [] },
    { transactionIds: ['same', 'same'] },
    {
      transactionIds: Array.from(
        { length: 51 },
        (_, index) => `payment-${index}`,
      ),
    },
  ])(
    'rejects an empty, duplicated or oversized selection: %j',
    async ({ transactionIds }) => {
      const dto = Object.assign(new BatchReviewTransactionRiskDto(), {
        transactionIds,
        riskStatus: ReviewableRiskStatusDto.CLEAR,
      });
      expect((await validate(dto)).length).toBeGreaterThan(0);
    },
  );

  it('requires a supported decision and accepts a bounded explicit selection', async () => {
    const dto = Object.assign(new BatchReviewTransactionRiskDto(), {
      transactionIds: ['one', 'two'],
      riskStatus: ReviewableRiskStatusDto.HOLD,
      note: 'Reviewed together',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(
      await validate(
        Object.assign(new BatchReviewTransactionRiskDto(), {
          transactionIds: ['one'],
          riskStatus: 'BLOCKED',
        }),
      ),
    ).not.toHaveLength(0);
  });
});

import {
  CreatorSettlementProfileStatus,
  PaymentProvider,
  RiskStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import { TransactionReferenceService } from './transaction-reference.service';
import { ReviewableRiskStatusDto } from './dto/review-transaction-risk.dto';

describe('TransactionReferenceService', () => {
  const originalOpsKey = process.env.INTERNAL_OPS_KEY;

  let prisma: any;
  let service: TransactionReferenceService;

  beforeEach(() => {
    process.env.INTERNAL_OPS_KEY = 'ops-key';
    prisma = {
      transactionReference: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      creatorSettlementProfile: {
        findUnique: jest.fn(),
      },
    };

    service = new TransactionReferenceService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterAll(() => {
    process.env.INTERNAL_OPS_KEY = originalOpsKey;
  });

  it('allows ops to clear a held transaction and make it ready for settlement', async () => {
    const createdAt = new Date('2026-03-29T10:00:00.000Z');
    const fulfilledAt = new Date('2026-03-29T10:05:00.000Z');
    const transaction = {
      id: 'txn_123',
      status: TransactionStatusType.SUCCESS,
      settlementStatus: SettlementStatus.HELD_RISK,
      riskStatus: RiskStatus.HOLD,
      riskScore: 75,
      riskReasons: ['large_payment', 'device:abc123'],
      creatorId: null,
      metadata: {
        amountUnit: 'KOBO',
      },
      reviewedAt: null,
      createdAt,
      fulfilledAt,
      event: {
        id: 'event_123',
        title: 'Launch Party',
        creatorId: 'creator_123',
      },
    };

    prisma.transactionReference.findUnique.mockResolvedValue(transaction);
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue({
      status: CreatorSettlementProfileStatus.ACTIVE,
    });
    prisma.transactionReference.update.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => ({
        ...transaction,
        ...data,
        event: {
          id: 'event_123',
          title: 'Launch Party',
        },
      }),
    );

    const result = await service.reviewTransactionRisk(
      'txn_123',
      {
        riskStatus: ReviewableRiskStatusDto.CLEAR,
        note: 'Cleared after manual payment review',
      },
      'ops-key',
    );

    expect(prisma.transactionReference.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'txn_123' },
        data: expect.objectContaining({
          riskStatus: RiskStatus.CLEAR,
          settlementStatus: SettlementStatus.READY,
          reviewedAt: expect.any(Date),
        }),
      }),
    );

    const updateInput = prisma.transactionReference.update.mock.calls[0][0];
    expect(updateInput.data.metadata).toMatchObject({
      amountUnit: 'KOBO',
      lastRiskReview: expect.objectContaining({
        reviewedBy: 'OPS',
        previousRiskStatus: RiskStatus.HOLD,
        nextRiskStatus: RiskStatus.CLEAR,
        previousSettlementStatus: SettlementStatus.HELD_RISK,
        nextSettlementStatus: SettlementStatus.READY,
        note: 'Cleared after manual payment review',
      }),
    });
    expect(updateInput.data.metadata.riskReviewHistory).toHaveLength(1);

    expect(result).toEqual(
      expect.objectContaining({
        id: 'txn_123',
        riskStatus: RiskStatus.CLEAR,
        settlementStatus: SettlementStatus.READY,
        riskScore: 75,
        riskReasons: ['large_payment', 'device:abc123'],
        riskReviewNote: 'Cleared after manual payment review',
        event: {
          id: 'event_123',
          title: 'Launch Party',
        },
        createdAt,
        fulfilledAt,
      }),
    );
  });

  it('keeps a manually cleared transaction in KYC hold until the payout profile is active', async () => {
    const transaction = {
      id: 'txn_held_kyc',
      status: TransactionStatusType.SUCCESS,
      settlementStatus: SettlementStatus.HELD_KYC,
      riskStatus: RiskStatus.REVIEW,
      riskScore: 45,
      riskReasons: ['creator_kyc_pending'],
      creatorId: 'creator_123',
      metadata: {
        amountUnit: 'KOBO',
      },
      reviewedAt: null,
      createdAt: new Date('2026-03-29T10:00:00.000Z'),
      fulfilledAt: new Date('2026-03-29T10:05:00.000Z'),
      event: {
        id: 'event_123',
        title: 'Launch Party',
        creatorId: 'creator_123',
      },
    };

    prisma.transactionReference.findUnique.mockResolvedValue(transaction);
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue({
      status: CreatorSettlementProfileStatus.PENDING_KYC,
    });
    prisma.transactionReference.update.mockImplementation(
      async ({ data }: { data: Record<string, any> }) => ({
        ...transaction,
        ...data,
        event: {
          id: 'event_123',
          title: 'Launch Party',
        },
      }),
    );

    const result = await service.reviewTransactionRisk(
      'txn_held_kyc',
      {
        riskStatus: ReviewableRiskStatusDto.CLEAR,
      },
      'ops-key',
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 'txn_held_kyc',
        riskStatus: RiskStatus.CLEAR,
        settlementStatus: SettlementStatus.HELD_KYC,
      }),
    );
  });

  it('lists the default REVIEW and HOLD queue with ops-facing context', async () => {
    const reviewedAt = new Date('2026-03-29T13:00:00.000Z');
    prisma.transactionReference.findMany.mockResolvedValue([
      {
        id: 'txn_queue_123',
        userId: 'buyer_123',
        creatorId: null,
        status: TransactionStatusType.SUCCESS,
        paymentType: 'DONATION',
        paymentProvider: PaymentProvider.PAYSTACK,
        amount: 255000,
        creatorPayable: 225000,
        settlementStatus: SettlementStatus.HELD_RISK,
        riskStatus: RiskStatus.REVIEW,
        riskScore: 45,
        riskReasons: ['large_payment', 'device:abc123'],
        metadata: {
          amountUnit: 'KOBO',
          pricing: {
            grossAmountKobo: 250000,
          },
          clientContext: {
            deviceId: 'abc123',
            platform: 'ios',
          },
          lastRiskReview: {
            note: 'Requested additional proof of payment',
          },
        },
        reviewedAt,
        createdAt: new Date('2026-03-29T10:00:00.000Z'),
        fulfilledAt: new Date('2026-03-29T10:05:00.000Z'),
        user: {
          id: 'buyer_123',
          username: 'buyer_user',
          fullName: 'Buyer User',
          email: 'buyer@example.com',
        },
        creator: null,
        event: {
          id: 'event_123',
          title: 'Launch Party',
          creatorId: 'creator_123',
          creator: {
            id: 'creator_123',
            username: 'creator_user',
            fullName: 'Creator User',
          },
        },
      },
    ]);
    prisma.transactionReference.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    const result = await service.getRiskReviewQueue({}, 'ops-key');

    expect(prisma.transactionReference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          riskStatus: {
            in: [RiskStatus.REVIEW, RiskStatus.HOLD],
          },
          status: {
            in: [
              TransactionStatusType.PENDING,
              TransactionStatusType.AWAITING_TRANSFER,
              TransactionStatusType.SUCCESS,
            ],
          },
        }),
      }),
    );

    expect(result).toEqual({
      data: [
        expect.objectContaining({
          id: 'txn_queue_123',
          transactionStatus: TransactionStatusType.SUCCESS,
          grossAmount: 2500,
          chargedAmount: 2550,
          creatorPayable: 2250,
          riskReasons: ['large_payment', 'device:abc123'],
          hasManualReview: true,
          riskReviewNote: 'Requested additional proof of payment',
          clientContext: {
            deviceId: 'abc123',
            platform: 'ios',
          },
          buyer: {
            id: 'buyer_123',
            username: 'buyer_user',
            fullName: 'Buyer User',
            email: 'buyer@example.com',
          },
          creator: {
            id: 'creator_123',
            username: 'creator_user',
            fullName: 'Creator User',
          },
          event: {
            id: 'event_123',
            title: 'Launch Party',
          },
          reviewedAt,
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: {
        reviewCount: 1,
        holdCount: 0,
        reviewedCount: 1,
      },
    });
  });
});

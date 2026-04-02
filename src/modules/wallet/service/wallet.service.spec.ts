import {
  AccountOwnershipType,
  CreatorAlatProfileStatus,
  CreatorSettlementProfileStatus,
  KycVerificationStatus,
  NameMatchStatus,
  PaymentProvider,
  PaymentType,
  RiskStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let prisma: any;
  let service: WalletService;

  beforeEach(() => {
    prisma = {
      creatorSettlementProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
      },
      creatorKycVerification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      creatorAlatProfile: {
        upsert: jest.fn(),
      },
      settlementAccountChange: {
        create: jest.fn(),
      },
      user: {
        count: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      transactionReference: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    service = new WalletService(prisma, {} as any, {} as any);
    (service as any).backfillCreatorTransactions = jest
      .fn()
      .mockResolvedValue(undefined);
    (service as any).syncCreatorSettlementStatus = jest
      .fn()
      .mockResolvedValue(undefined);
  });

  it('includes risk reasons and manual review details in wallet transaction history', async () => {
    const reviewedAt = new Date('2026-03-29T12:00:00.000Z');
    prisma.transactionReference.findMany.mockResolvedValue([
      {
        id: 'txn_123',
        paymentType: PaymentType.DONATION,
        paymentProvider: PaymentProvider.PAYSTACK,
        amount: 250000,
        platformFee: 25000,
        providerFee: 0,
        creatorPayable: 225000,
        settlementStatus: SettlementStatus.READY,
        riskStatus: RiskStatus.CLEAR,
        riskScore: 45,
        riskReasons: ['large_payment', 'device:abc123'],
        metadata: {
          amountUnit: 'KOBO',
          lastRiskReview: {
            note: 'Cleared after manual payment review',
          },
        },
        reviewedAt,
        status: TransactionStatusType.SUCCESS,
        event: {
          title: 'Launch Party',
        },
        user: {
          username: 'buyer_user',
          fullName: 'Buyer User',
        },
        createdAt: new Date('2026-03-29T10:00:00.000Z'),
      },
    ]);
    prisma.transactionReference.count.mockResolvedValue(1);

    const result = await service.getTransactionHistory('creator_123', {});

    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'txn_123',
        riskReasons: ['large_payment', 'device_signal_recorded'],
        riskReviewNote: 'Cleared after manual payment review',
        reviewedAt,
      }),
    ]);
  });

  it('rejects duplicate payout accounts before verifying the payout profile', async () => {
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(null);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue({
      userId: 'user-existing',
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Creator User',
      phoneNumber: '08030000000',
    });

    const verifyPayoutAccountSpy = jest.spyOn(
      service as any,
      'verifyPayoutAccount',
    );

    await expect(
      service.upsertPayoutProfile('user-new', {
        accountOwnershipType: AccountOwnershipType.PERSONAL as any,
        bankName: 'Wema Bank',
        bankCode: '035',
        accountNumber: '0123456789',
        legalName: 'Creator User',
      } as any),
    ).rejects.toThrow(
      'This payout account is already linked to another GatherGo account. Use a different account number before continuing.',
    );

    expect(verifyPayoutAccountSpy).not.toHaveBeenCalled();
    expect(prisma.creatorSettlementProfile.upsert).not.toHaveBeenCalled();
  });

  it('blocks personal KYC from starting when the payout account is already used elsewhere', async () => {
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue({
      id: 'settlement-1',
      userId: 'user-new',
      legalName: 'Creator User',
      accountName: 'Creator User',
      bankCode: '035',
      accountNumber: '0123456789',
    });
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue({
      userId: 'user-existing',
    });
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Creator User',
      phoneNumber: '08030000000',
      email: 'creator@example.com',
      gender: 'MALE',
    });

    await expect(
      service.startPersonalKyc('user-new', {
        phoneNumber: '08030000000',
        nin: '12345678901',
      } as any),
    ).rejects.toThrow(
      'This payout account is already linked to another GatherGo account. Use a different account number before continuing.',
    );

    expect(prisma.creatorKycVerification.upsert).not.toHaveBeenCalled();
  });

  it('returns an internal KYC queue with summary and formatted review context', async () => {
    process.env.INTERNAL_OPS_KEY = 'ops-secret';

    prisma.creatorKycVerification.findMany.mockResolvedValue([
      {
        id: 'kyc_123',
        userId: 'creator_123',
        provider: 'QOREID',
        status: KycVerificationStatus.SUBMITTED,
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        verificationMode: 'BUSINESS_CAC_REP_NIN',
        businessStatus: KycVerificationStatus.VERIFIED,
        identityStatus: KycVerificationStatus.SUBMITTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        amlStatus: KycVerificationStatus.NOT_STARTED,
        dedupStatus: KycVerificationStatus.NOT_STARTED,
        nameMatchStatus: NameMatchStatus.REVIEW_REQUIRED,
        verifiedFullName: 'Ada Example',
        verifiedBusinessName: 'Example Events Ltd',
        rejectionReason: null,
        nameMatchReason: 'Name alignment needs manual confirmation',
        identityReferenceMasked: '*******1234',
        providerSubjectLast4: '0000',
        businessReferenceLast4: '4321',
        submittedAt: new Date('2026-04-01T10:00:00.000Z'),
        reviewedAt: null,
        createdAt: new Date('2026-03-30T09:00:00.000Z'),
        updatedAt: new Date('2026-04-01T11:00:00.000Z'),
        user: {
          id: 'creator_123',
          username: 'events_by_ada',
          fullName: 'Ada Example',
          email: 'ada@example.com',
          createdAt: new Date('2025-12-01T08:00:00.000Z'),
        },
        settlementProfile: {
          status: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          businessName: 'Example Events Ltd',
          legalName: null,
          bankName: 'Wema Bank',
          bankCode: '035',
          accountName: 'Example Events Ltd',
          accountNumberMasked: '******6789',
          accountNumber: '0123456789',
          bvnLast4: null,
          kycStatus: KycVerificationStatus.SUBMITTED,
          nameMatchStatus: NameMatchStatus.REVIEW_REQUIRED,
          accountVerifiedAt: new Date('2026-03-29T09:00:00.000Z'),
          rejectionReason: null,
          submittedAt: new Date('2026-04-01T10:00:00.000Z'),
          approvedAt: null,
          rejectedAt: null,
          updatedAt: new Date('2026-04-01T11:00:00.000Z'),
        },
      },
    ]);
    prisma.creatorKycVerification.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const result = await service.getInternalKycQueue({}, 'ops-secret');

    expect(prisma.creatorKycVerification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
        take: 20,
        skip: 0,
      }),
    );
    expect(result.summary).toEqual({
      submittedCount: 1,
      providerPendingCount: 0,
      reviewRequiredCount: 1,
      reviewedCount: 0,
    });
    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'kyc_123',
        hasManualReview: false,
        user: expect.objectContaining({
          fullName: 'Ada Example',
          email: 'ada@example.com',
        }),
        payoutProfile: expect.objectContaining({
          status: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
          accountNumberMasked: '******6789',
        }),
        verification: expect.objectContaining({
          status: KycVerificationStatus.SUBMITTED,
          nameMatchStatus: NameMatchStatus.REVIEW_REQUIRED,
          nameMatchReason: 'Name alignment needs manual confirmation',
          identityReferenceMasked: '*******1234',
        }),
      }),
    ]);
  });

  it('returns an internal ALAT queue with payout readiness context', async () => {
    process.env.INTERNAL_OPS_KEY = 'ops-secret';

    prisma.user.findMany.mockResolvedValue([
      {
        id: 'creator_123',
        username: 'events_by_ada',
        fullName: 'Ada Example',
        email: 'ada@example.com',
        createdAt: new Date('2025-12-01T08:00:00.000Z'),
        settlementProfile: {
          status: CreatorSettlementProfileStatus.ACTIVE,
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          businessName: 'Example Events Ltd',
          legalName: null,
          bankName: 'Wema Bank',
          bankCode: '035',
          accountName: 'Example Events Ltd',
          accountNumberMasked: '******6789',
          accountNumber: '0123456789',
          bvnLast4: null,
          kycStatus: KycVerificationStatus.VERIFIED,
          nameMatchStatus: NameMatchStatus.MATCHED,
          accountVerifiedAt: new Date('2026-03-29T09:00:00.000Z'),
          rejectionReason: null,
          submittedAt: new Date('2026-04-01T10:00:00.000Z'),
          approvedAt: new Date('2026-04-01T12:00:00.000Z'),
        },
        alatProfile: {
          status: CreatorAlatProfileStatus.PENDING_REVIEW,
          displayName: 'GatherGo - Example Events Ltd',
          businessId: 'alat-biz-123',
          subaccountReference: 'sub-001',
          accountNumber: '0123456789',
          accountName: 'Example Events Ltd',
          activatedAt: null,
          reviewedAt: new Date('2026-04-01T13:00:00.000Z'),
          notes: 'Awaiting final ALAT approval',
        },
        _count: {
          eventsCreated: 4,
        },
      },
    ]);
    prisma.user.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const result = await service.getInternalAlatQueue({}, 'ops-secret');

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlementProfile: {
            is: {
              status: CreatorSettlementProfileStatus.ACTIVE,
            },
          },
          OR: expect.any(Array),
        }),
        take: 20,
        skip: 0,
      }),
    );
    expect(result.summary).toEqual({
      payoutActiveCount: 5,
      pendingActivationCount: 3,
      activeAlatCount: 2,
      rejectedAlatCount: 1,
    });
    expect(result.data).toEqual([
      expect.objectContaining({
        id: 'creator_123',
        needsAction: true,
        eventCount: 4,
        user: expect.objectContaining({
          fullName: 'Ada Example',
          email: 'ada@example.com',
        }),
        payoutProfile: expect.objectContaining({
          status: CreatorSettlementProfileStatus.ACTIVE,
          accountNumber: '0123456789',
        }),
        alatProfile: expect.objectContaining({
          status: CreatorAlatProfileStatus.PENDING_REVIEW,
          businessId: 'alat-biz-123',
          accountNumberMasked: '******6789',
        }),
      }),
    ]);
  });
});

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
  let dikriptService: any;
  let paystackService: any;
  let service: WalletService;

  beforeEach(() => {
    prisma = {
      creatorSettlementProfile: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
      },
      creatorKycVerification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
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
        aggregate: jest.fn(),
      },
    };

    paystackService = {
      listBanks: jest.fn(),
      resolveBankAccount: jest.fn(),
    };
    dikriptService = {
      verifyNin: jest.fn(),
      verifyVirtualNin: jest.fn(),
      verifyBvn: jest.fn(),
      verifyPhone: jest.fn(),
      verifyNinByPhone: jest.fn(),
      verifyPassport: jest.fn(),
      verifyCacBasic: jest.fn(),
      verifyCacAdvanced: jest.fn(),
      verifyLiveness: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    };

    service = new WalletService(
      prisma,
      dikriptService,
      paystackService,
      {} as any,
    );
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

  it('rejects duplicate payout accounts before resolving the payout profile', async () => {
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(null);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue({
      userId: 'user-existing',
    });
    await expect(
      service.upsertPayoutProfile('user-new', {
        accountOwnershipType: AccountOwnershipType.PERSONAL as any,
        bankName: 'Wema Bank',
        bankCode: '035',
        accountNumber: '0123456789',
      } as any),
    ).rejects.toThrow(
      'This payout account is already linked to another GatherGo account. Use a different account number before continuing.',
    );

    expect(paystackService.resolveBankAccount).not.toHaveBeenCalled();
    expect(prisma.creatorSettlementProfile.upsert).not.toHaveBeenCalled();
  });

  it('resolves payout accounts with Paystack before saving the profile', async () => {
    const accountVerifiedAt = new Date('2026-03-29T10:00:00.000Z');
    const accountNumberHash = (service as any).hashKycSubject('0123456789');
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(null);
    prisma.creatorKycVerification.findUnique.mockResolvedValue(null);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    paystackService.resolveBankAccount.mockResolvedValue({
      status: true,
      message: 'Account number resolved',
      data: {
        account_number: '0123456789',
        account_name: 'ADEBOLA LATEEF',
      },
    });
    prisma.creatorSettlementProfile.upsert.mockResolvedValue({
      id: 'settlement-1',
      userId: 'creator_123',
      businessName: null,
      legalName: 'ADEBOLA LATEEF',
      accountOwnershipType: AccountOwnershipType.PERSONAL,
      bankName: 'Wema Bank',
      bankCode: '035',
      accountName: 'ADEBOLA LATEEF',
      accountNumber: '0123456789',
      accountNumberMasked: '******6789',
      bvnLast4: null,
      accountVerifiedAt,
      kycStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: NameMatchStatus.NOT_CHECKED,
      status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
      metadata: {
        accountNameConfirmation: {
          accountName: 'ADEBOLA LATEEF',
          bankCode: '035',
          accountNumberHash,
        },
      },
      submittedAt: accountVerifiedAt,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    });

    const result = await service.upsertPayoutProfile('creator_123', {
      accountOwnershipType: AccountOwnershipType.PERSONAL as any,
      bankName: 'Wema Bank',
      bankCode: '035',
      accountNumber: '0123456789',
    });

    expect(paystackService.resolveBankAccount).toHaveBeenCalledWith({
      accountNumber: '0123456789',
      bankCode: '035',
    });
    expect(prisma.creatorSettlementProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          businessName: null,
          legalName: 'ADEBOLA LATEEF',
          bvnLast4: null,
          accountName: 'ADEBOLA LATEEF',
          status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
          metadata: expect.objectContaining({
            accountNameConfirmation: expect.objectContaining({
              accountName: 'ADEBOLA LATEEF',
              bankCode: '035',
              accountNumberHash: expect.any(String),
            }),
            paystack: expect.objectContaining({
              provider: 'PAYSTACK',
              accountName: 'ADEBOLA LATEEF',
              accountNumberHash: expect.any(String),
            }),
            verificationCost: expect.objectContaining({
              payoutAccount: expect.objectContaining({
                provider: 'PAYSTACK',
                charged: false,
                reused: false,
              }),
            }),
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        accountName: 'ADEBOLA LATEEF',
        legalName: 'ADEBOLA LATEEF',
        accountNameConfirmed: true,
      }),
    );
  });

  it('uses the resolved payout account name as the saved business name', async () => {
    const accountVerifiedAt = new Date('2026-03-29T10:00:00.000Z');
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(null);
    prisma.creatorKycVerification.findUnique.mockResolvedValue(null);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    paystackService.resolveBankAccount.mockResolvedValue({
      status: true,
      message: 'Account number resolved',
      data: {
        account_number: '0123456789',
        account_name: 'EXAMPLE EVENTS LTD',
      },
    });
    prisma.creatorSettlementProfile.upsert.mockResolvedValue({
      id: 'settlement-1',
      userId: 'creator_123',
      businessName: 'EXAMPLE EVENTS LTD',
      legalName: null,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      bankName: 'Wema Bank',
      bankCode: '035',
      accountName: 'EXAMPLE EVENTS LTD',
      accountNumber: '0123456789',
      accountNumberMasked: '******6789',
      bvnLast4: null,
      accountVerifiedAt,
      kycStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: NameMatchStatus.NOT_CHECKED,
      status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
      metadata: {},
      submittedAt: accountVerifiedAt,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    });

    const result = await service.upsertPayoutProfile('creator_123', {
      accountOwnershipType: AccountOwnershipType.BUSINESS as any,
      bankName: 'Wema Bank',
      bankCode: '035',
      accountNumber: '0123456789',
    });

    expect(prisma.creatorSettlementProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          businessName: 'EXAMPLE EVENTS LTD',
          legalName: null,
          accountName: 'EXAMPLE EVENTS LTD',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        businessName: 'EXAMPLE EVENTS LTD',
        legalName: null,
        accountName: 'EXAMPLE EVENTS LTD',
      }),
    );
  });

  it('resolves payout account names through Paystack', async () => {
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    paystackService.resolveBankAccount.mockResolvedValue({
      status: true,
      message: 'Account number resolved',
      data: {
        account_number: '0123456789',
        account_name: 'ADEBOLA LATEEF',
      },
    });

    const result = await service.resolvePayoutAccount('creator_123', {
      bankCode: '035',
      accountNumber: '0123456789',
    });

    expect(paystackService.resolveBankAccount).toHaveBeenCalledWith({
      accountNumber: '0123456789',
      bankCode: '035',
    });
    expect(result).toEqual({
      data: {
        accountNumber: '0123456789',
        accountName: 'ADEBOLA LATEEF',
      },
    });
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

  it('uses Dikript phone-NIN lookup for explicit personal phone-NIN mode', async () => {
    dikriptService.verifyNinByPhone.mockResolvedValue({
      id: 'nin_phone_123',
      status: { status: 'verified' },
      summary: { identity_check: 'EXACT_MATCH' },
      nin: {
        nin: '12345678901',
        firstname: 'Ada',
        lastname: 'Example',
        phoneNumber: '08030000000',
      },
    });

    const result = await (service as any).verifyPersonalIdentityWithDikript({
      verificationMode: 'PERSONAL_PHONE_NIN',
      dto: {
        phoneNumber: '08030000000',
      },
      resolvedNames: {
        firstName: 'Ada',
        lastName: 'Example',
      },
      user: null,
    });

    expect(dikriptService.verifyNinByPhone).toHaveBeenCalledWith({
      phoneNumber: '08030000000',
      firstName: 'Ada',
      lastName: 'Example',
      dateOfBirth: null,
      phone: '08030000000',
      email: null,
      gender: null,
    });
    expect(dikriptService.verifyPhone).not.toHaveBeenCalled();
    expect(result.nin?.nin).toBe('12345678901');
  });

  it('uses Dikript phone-NIN lookup for explicit business representative phone-NIN mode', async () => {
    dikriptService.verifyNinByPhone.mockResolvedValue({
      id: 'rep_nin_phone_123',
      status: { status: 'verified' },
      summary: { identity_check: 'EXACT_MATCH' },
      nin: {
        nin: '12345678901',
        firstname: 'Ada',
        lastname: 'Example',
        phoneNumber: '08030000000',
      },
    });

    const result = await (
      service as any
    ).verifyBusinessRepresentativeWithDikript({
      verificationMode: 'BUSINESS_CAC_REP_PHONE_NIN',
      dto: {
        representativePhoneNumber: '08030000000',
      },
      representativeNames: {
        firstName: 'Ada',
        lastName: 'Example',
      },
      user: null,
    });

    expect(dikriptService.verifyNinByPhone).toHaveBeenCalledWith({
      phoneNumber: '08030000000',
      firstName: 'Ada',
      lastName: 'Example',
      dateOfBirth: null,
      phone: '08030000000',
      email: null,
      gender: null,
    });
    expect(dikriptService.verifyPhone).not.toHaveBeenCalled();
    expect(result.nin?.nin).toBe('12345678901');
  });

  it('auto-approves Basic KYC when personal identity matches the payout account', async () => {
    const accountVerifiedAt = new Date('2026-04-01T10:00:00.000Z');
    const payoutProfile = {
      id: 'settlement-1',
      userId: 'creator_123',
      status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
      accountOwnershipType: AccountOwnershipType.PERSONAL,
      legalName: 'Ada Example',
      businessName: null,
      accountName: 'Ada Example',
      bankCode: '035',
      accountNumber: '0123456789',
      accountVerifiedAt,
      metadata: {},
    };

    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(payoutProfile);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    prisma.creatorKycVerification.findUnique.mockResolvedValue(null);
    prisma.creatorKycVerification.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ada Example',
      phoneNumber: '08030000000',
      email: 'ada@example.com',
      gender: 'FEMALE',
    });
    prisma.transactionReference.aggregate.mockResolvedValue({
      _sum: { creatorPayable: 0 },
    });
    dikriptService.verifyNin.mockResolvedValue({
      id: 'nin_123',
      status: { status: 'verified' },
      summary: { nin_check: { status: 'EXACT_MATCH' } },
      nin: {
        nin: '12345678901',
        firstname: 'Ada',
        lastname: 'Example',
        birthdate: '1990-01-01',
      },
    });
    prisma.creatorKycVerification.upsert.mockImplementation(({ create }: any) =>
      Promise.resolve({
        id: 'kyc_123',
        amlStatus: KycVerificationStatus.NOT_STARTED,
        ...create,
      }),
    );
    prisma.creatorSettlementProfile.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...payoutProfile, ...data }),
    );

    const result = await service.startPersonalKyc('creator_123', {
      verificationMode: 'PERSONAL_NIN',
      nin: '12345678901',
    } as any);

    expect(prisma.creatorKycVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: KycVerificationStatus.VERIFIED,
          identityStatus: KycVerificationStatus.VERIFIED,
          nameMatchStatus: NameMatchStatus.MATCHED,
          metadata: expect.objectContaining({
            kycTier: 'BASIC',
            approvedTier: 'BASIC',
            targetTier: 'BASIC',
          }),
        }),
      }),
    );
    expect(prisma.creatorSettlementProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CreatorSettlementProfileStatus.ACTIVE,
          kycStatus: KycVerificationStatus.VERIFIED,
          metadata: expect.objectContaining({
            kycTier: 'BASIC',
            approvedTier: 'BASIC',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: KycVerificationStatus.VERIFIED,
        kycTier: 'BASIC',
        canSubmitBasicKyc: false,
      }),
    );
    expect(result.steps.map((step) => step.code)).not.toContain('BASIC_SUBMIT');
  });

  it('auto-approves Basic KYC when business CAC matches the payout account', async () => {
    const accountVerifiedAt = new Date('2026-04-01T10:00:00.000Z');
    const payoutProfile = {
      id: 'settlement-1',
      userId: 'creator_123',
      status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      legalName: null,
      businessName: 'Example Events Ltd',
      accountName: 'Example Events Ltd',
      bankCode: '035',
      accountNumber: '0123456789',
      accountVerifiedAt,
      metadata: {},
    };

    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(payoutProfile);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    prisma.creatorKycVerification.findUnique.mockResolvedValue(null);
    prisma.creatorKycVerification.findMany.mockResolvedValue([]);
    prisma.transactionReference.aggregate.mockResolvedValue({
      _sum: { creatorPayable: 0 },
    });
    dikriptService.verifyCacBasic.mockResolvedValue({
      id: 'cac_123',
      status: { status: 'verified' },
      summary: { cac_check: 'verified' },
      cac: {
        rcNumber: '1234567',
        companyName: 'Example Events Ltd',
      },
    });
    prisma.creatorKycVerification.upsert.mockImplementation(({ create }: any) =>
      Promise.resolve({
        id: 'kyc_123',
        amlStatus: KycVerificationStatus.NOT_STARTED,
        ...create,
      }),
    );
    prisma.creatorSettlementProfile.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...payoutProfile, ...data }),
    );

    const result = await service.startBusinessKyc('creator_123', {
      regNumber: '1234567',
    } as any);

    expect(prisma.creatorKycVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: KycVerificationStatus.VERIFIED,
          businessStatus: KycVerificationStatus.VERIFIED,
          nameMatchStatus: NameMatchStatus.MATCHED,
          metadata: expect.objectContaining({
            kycTier: 'BASIC',
            approvedTier: 'BASIC',
            targetTier: 'BASIC',
          }),
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: KycVerificationStatus.VERIFIED,
        kycTier: 'BASIC',
        canSubmitBasicKyc: false,
      }),
    );
    expect(result.steps.map((step) => step.code)).not.toContain('BASIC_SUBMIT');
  });

  it('sends business Basic KYC to ops review when the CAC name is unclear', async () => {
    const accountVerifiedAt = new Date('2026-04-01T10:00:00.000Z');
    const payoutProfile = {
      id: 'settlement-1',
      userId: 'creator_123',
      status: CreatorSettlementProfileStatus.ACCOUNT_VERIFIED,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      legalName: null,
      businessName: 'Example Events Ltd',
      accountName: 'Example Events Ltd',
      bankCode: '035',
      accountNumber: '0123456789',
      accountVerifiedAt,
      metadata: {},
    };

    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(payoutProfile);
    prisma.creatorSettlementProfile.findFirst.mockResolvedValue(null);
    prisma.creatorKycVerification.findUnique.mockResolvedValue(null);
    prisma.creatorKycVerification.findMany.mockResolvedValue([]);
    prisma.transactionReference.aggregate.mockResolvedValue({
      _sum: { creatorPayable: 0 },
    });
    dikriptService.verifyCacBasic.mockResolvedValue({
      id: 'cac_123',
      status: { status: 'verified' },
      summary: { cac_check: 'verified' },
      cac: {
        rcNumber: '1234567',
        companyName: 'Different Events Ltd',
      },
    });
    prisma.creatorKycVerification.upsert.mockImplementation(({ create }: any) =>
      Promise.resolve({
        id: 'kyc_123',
        amlStatus: KycVerificationStatus.NOT_STARTED,
        ...create,
      }),
    );
    prisma.creatorSettlementProfile.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...payoutProfile, ...data }),
    );

    const result = await service.startBusinessKyc('creator_123', {
      regNumber: '1234567',
    } as any);

    expect(prisma.creatorKycVerification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: KycVerificationStatus.SUBMITTED,
          businessStatus: KycVerificationStatus.VERIFIED,
          nameMatchStatus: NameMatchStatus.REVIEW_REQUIRED,
          metadata: expect.objectContaining({
            kycTier: 'NONE',
            approvedTier: 'NONE',
            targetTier: 'BASIC',
          }),
        }),
      }),
    );
    expect(prisma.creatorSettlementProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
          kycStatus: KycVerificationStatus.SUBMITTED,
          nameMatchStatus: NameMatchStatus.REVIEW_REQUIRED,
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: KycVerificationStatus.SUBMITTED,
        kycTier: 'NONE',
      }),
    );
  });

  it('returns Nigerian payout banks from Paystack using the wallet bank shape', async () => {
    paystackService.listBanks.mockResolvedValue({
      status: true,
      message: 'Banks retrieved',
      data: [
        {
          id: 1,
          name: 'Wema Bank',
          slug: 'wema-bank',
          code: '035',
          longcode: '035150103',
          gateway: null,
          pay_with_bank: false,
          active: true,
          country: 'Nigeria',
          currency: 'NGN',
          type: 'nuban',
          is_deleted: false,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getBanks();

    expect(paystackService.listBanks).toHaveBeenCalledWith('nigeria');
    expect(result).toEqual({
      data: [
        {
          name: 'Wema Bank',
          code: '035',
          longcode: '035150103',
        },
      ],
    });
  });

  it('allows business Basic KYC submission after CAC Basic without representative identity', async () => {
    const verification = {
      id: 'kyc_123',
      userId: 'creator_123',
      provider: 'DIKRIPT',
      status: KycVerificationStatus.IN_PROGRESS,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      verificationMode: null,
      businessStatus: KycVerificationStatus.VERIFIED,
      identityStatus: KycVerificationStatus.NOT_STARTED,
      livenessStatus: KycVerificationStatus.NOT_STARTED,
      amlStatus: KycVerificationStatus.NOT_STARTED,
      dedupStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: NameMatchStatus.MATCHED,
      verifiedFullName: null,
      verifiedBusinessName: 'Example Events Ltd',
      rejectionReason: null,
      nameMatchReason: null,
      metadata: {
        businessDraft: {
          regNumber: '1234567',
          regNumberMasked: '***4567',
        },
      },
    };
    const payoutProfile = {
      id: 'settlement-1',
      userId: 'creator_123',
      status: CreatorSettlementProfileStatus.PENDING_KYC,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      accountName: 'Example Events Ltd',
      accountVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
      metadata: {},
    };

    prisma.creatorKycVerification.findUnique.mockResolvedValue(verification);
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue(payoutProfile);
    prisma.creatorKycVerification.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...verification, ...data }),
    );
    prisma.creatorSettlementProfile.update.mockResolvedValue({
      ...payoutProfile,
      status: CreatorSettlementProfileStatus.PENDING_KYC,
    });
    prisma.transactionReference.aggregate.mockResolvedValue({
      _sum: { creatorPayable: 0 },
    });

    const result = await service.submitKyc('creator_123', {
      confirm: true,
      targetTier: 'BASIC',
    } as any);

    expect(prisma.creatorKycVerification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'creator_123' },
        data: expect.objectContaining({
          status: KycVerificationStatus.SUBMITTED,
          metadata: expect.objectContaining({
            targetTier: 'BASIC',
          }),
        }),
      }),
    );
    expect(result.canSubmitBasicKyc).toBe(false);
  });

  it('requires representative identity before business Full KYC submission', async () => {
    prisma.creatorKycVerification.findUnique.mockResolvedValue({
      id: 'kyc_123',
      userId: 'creator_123',
      provider: 'DIKRIPT',
      status: KycVerificationStatus.VERIFIED,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      verificationMode: null,
      businessStatus: KycVerificationStatus.VERIFIED,
      identityStatus: KycVerificationStatus.NOT_STARTED,
      livenessStatus: KycVerificationStatus.VERIFIED,
      amlStatus: KycVerificationStatus.NOT_STARTED,
      dedupStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: NameMatchStatus.MATCHED,
      verifiedFullName: null,
      verifiedBusinessName: 'Example Events Ltd',
      rejectionReason: null,
      nameMatchReason: null,
      metadata: {
        kycTier: 'BASIC',
        approvedTier: 'BASIC',
      },
    });
    prisma.creatorSettlementProfile.findUnique.mockResolvedValue({
      id: 'settlement-1',
      userId: 'creator_123',
      status: CreatorSettlementProfileStatus.ACTIVE,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      accountName: 'Example Events Ltd',
      accountVerifiedAt: new Date('2026-04-01T10:00:00.000Z'),
      metadata: {
        kycTier: 'BASIC',
        approvedTier: 'BASIC',
      },
    });

    await expect(
      service.submitKyc('creator_123', {
        confirm: true,
        targetTier: 'FULL',
      } as any),
    ).rejects.toThrow(
      'Representative verification must pass before Full KYC can be submitted',
    );

    expect(prisma.creatorKycVerification.update).not.toHaveBeenCalled();
  });

  it('returns an internal KYC queue with summary and formatted review context', async () => {
    process.env.INTERNAL_OPS_KEY = 'ops-secret';

    prisma.creatorKycVerification.findMany.mockResolvedValue([
      {
        id: 'kyc_123',
        userId: 'creator_123',
        provider: 'DIKRIPT',
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

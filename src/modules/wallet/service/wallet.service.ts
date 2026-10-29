import { DashboardRole } from '@prisma/client';
import { assertDashboardAccess } from 'src/modules/dashboard-auth/dashboard-auth.policy';
import type { DashboardActor } from 'src/modules/dashboard-auth/dashboard-auth.types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { CreatorSettlementProfile } from '@prisma/client';
import {
  AccountOwnershipType,
  CreatorAlatProfileStatus,
  CreatorSettlementProfileStatus,
  KycVerificationStatus,
  NameMatchStatus,
  PaymentType,
  Prisma,
  RiskStatus,
  VerificationProvider,
  SettlementRecordStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaystackService } from 'src/modules/paystack/paystack.service';
import {
  resolveChargedAmountKobo,
  resolveGrossAmountKobo,
  resolveCreatorPayableKobo,
  resolvePlatformFeeKobo,
} from 'src/modules/transaction-reference/payment-pricing.util';
import {
  AccountChangesQueryDto,
  CompleteSettlementDto,
  CreateSettlementDto,
  CreatorPayoutProfileStatusDto,
  InternalAlatQueueQueryDto,
  InternalKycQueueQueryDto,
  InternalSettlementQueueQueryDto,
  InternalSettlementsQueryDto,
  KycTierDto,
  KycResolutionNotificationTargetDto,
  NotifyOnKycResolutionDto,
  PersonalLivenessDto,
  ReviewKycDto,
  ReviewPayoutProfileDto,
  ResolvePayoutAccountDto,
  StartBusinessKycDto,
  StartBusinessRepresentativeKycDto,
  StartPersonalKycDto,
  SubmitKycDto,
  SettlementRecordStatusDto,
  UpsertAlatProfileDto,
  UpsertPayoutProfileDto,
  WalletSettlementsQueryDto,
  WalletTransactionsQueryDto,
} from '../dto/wallet.dto';
import { notificationConstants } from 'src/common/constants';
import { NotificationService } from 'src/modules/notification/notification.service';
import {
  DikriptCacResponse,
  DikriptFaceVerificationResponse,
  DikriptNinResponse,
  DikriptService,
} from './dikript.service';

const walletTransactionInclude = {
  event: { select: { title: true } },
  user: { select: { username: true, fullName: true } },
} satisfies Prisma.TransactionReferenceInclude;
type WalletTransaction = Prisma.TransactionReferenceGetPayload<{
  include: typeof walletTransactionInclude;
}>;

const KYC_PROVIDER_DIKRIPT = VerificationProvider.DIKRIPT;
const BASIC_KYC_SETTLEMENT_CAP_NAIRA = Number(
  process.env.BASIC_KYC_SETTLEMENT_CAP_NGN || 5_000_000,
);
const BASIC_KYC_SETTLEMENT_CAP_KOBO =
  Math.max(BASIC_KYC_SETTLEMENT_CAP_NAIRA, 0) * 100;
type KycTier = KycTierDto.NONE | KycTierDto.BASIC | KycTierDto.FULL;

type KycTierSummary = {
  kycTier: KycTier;
  basicKycSettlementCap: number;
  basicKycSettlementUsage: number;
  basicKycSettlementRemaining: number;
  livenessRequired: boolean;
  livenessRequiredReason: string | null;
};

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dikriptService: DikriptService,
    private readonly paystackService: PaystackService,
    private readonly notificationService: NotificationService,
  ) {}

  async resetUnsuccessfulSettlementStatuses(
    scope: Prisma.TransactionReferenceWhereInput,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    await db.transactionReference.updateMany({
      where: {
        AND: [scope],
        status: { not: TransactionStatusType.SUCCESS },
        settlementStatus: {
          in: [
            SettlementStatus.READY,
            SettlementStatus.HELD_KYC,
            SettlementStatus.HELD_RISK,
          ],
        },
      },
      data: { settlementStatus: SettlementStatus.NOT_READY },
    });
  }

  async refreshCreatorSettlementStatus(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const profile = await db.creatorSettlementProfile.findUnique({
      where: { userId },
      select: { status: true },
    });
    await this.syncCreatorSettlementStatus(
      userId,
      profile?.status ?? CreatorSettlementProfileStatus.NOT_STARTED,
      db,
    );
  }

  async refreshSettlementStatuses(
    scope: Prisma.TransactionReferenceWhereInput,
  ) {
    await this.resetUnsuccessfulSettlementStatuses(scope);
    const payments = await this.prisma.transactionReference.findMany({
      where: { AND: [scope], status: TransactionStatusType.SUCCESS },
      select: { creatorId: true, event: { select: { creatorId: true } } },
      distinct: ['creatorId', 'eventId'],
    });
    const creatorIds = new Set(
      payments.map((payment) => payment.creatorId ?? payment.event?.creatorId),
    );
    for (const creatorId of creatorIds) {
      if (creatorId) await this.refreshCreatorSettlementStatus(creatorId);
    }
  }

  async getWalletOverview(userId: string) {
    await this.refreshCreatorSettlementStatus(userId);

    const [
      payoutProfile,
      alatProfile,
      balanceTransactions,
      recentTransactions,
      recentSettlements,
      settledAggregate,
    ] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorAlatProfile.findUnique({
        where: { userId },
      }),
      this.prisma.transactionReference.findMany({
        where: {
          creatorId: userId,
          status: TransactionStatusType.SUCCESS,
        },
        select: {
          amount: true,
          creatorPayable: true,
          platformFee: true,
          providerFee: true,
          settlementStatus: true,
          metadata: true,
        },
      }),
      this.prisma.transactionReference.findMany({
        where: {
          creatorId: userId,
          status: TransactionStatusType.SUCCESS,
        },
        include: walletTransactionInclude,
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.settlementRecord.findMany({
        where: { creatorId: userId },
        include: {
          allocations: {
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.settlementRecord.aggregate({
        _sum: { amount: true },
        where: {
          creatorId: userId,
          status: SettlementRecordStatus.SUCCESS,
        },
      }),
    ]);

    const balance = balanceTransactions.reduce(
      (acc, transaction) => {
        const grossAmountKobo = resolveGrossAmountKobo(transaction);
        const creatorPayableKobo = resolveCreatorPayableKobo(transaction);

        acc.totalCollected += grossAmountKobo;

        switch (transaction.settlementStatus) {
          case SettlementStatus.HELD_KYC:
          case SettlementStatus.HELD_RISK:
            acc.heldBalance += creatorPayableKobo;
            break;
          case SettlementStatus.READY:
            acc.availableBalance += creatorPayableKobo;
            break;
          case SettlementStatus.PROCESSING:
            acc.processingBalance += creatorPayableKobo;
            break;
          default:
            break;
        }

        return acc;
      },
      {
        heldBalance: 0,
        availableBalance: 0,
        processingBalance: 0,
        settledBalance: settledAggregate._sum.amount || 0,
        totalCollected: 0,
      },
    );

    return {
      balance: {
        heldBalance: balance.heldBalance / 100,
        availableBalance: balance.availableBalance / 100,
        processingBalance: balance.processingBalance / 100,
        settledBalance: balance.settledBalance / 100,
        totalCollected: balance.totalCollected / 100,
        currency: 'NGN',
      },
      payoutProfile: payoutProfile
        ? this.formatPayoutProfile(payoutProfile)
        : null,
      alatProfile: alatProfile ? this.formatAlatProfile(alatProfile) : null,
      recentTransactions: recentTransactions.map((transaction) =>
        this.formatTransaction(transaction),
      ),
      recentSettlements: recentSettlements.map((settlement) =>
        this.formatSettlement(settlement),
      ),
    };
  }

  async getPayoutProfile(userId: string) {
    const profile = await this.prisma.creatorSettlementProfile.findUnique({
      where: { userId },
    });

    return profile ? this.formatPayoutProfile(profile) : null;
  }

  async getOnboarding(userId: string) {
    const [payoutProfile, kycVerification, alatProfile] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
      this.prisma.creatorAlatProfile.findUnique({
        where: { userId },
      }),
    ]);

    const payoutStatus =
      payoutProfile?.status || CreatorSettlementProfileStatus.NOT_STARTED;
    const kycStatus =
      kycVerification?.status ||
      this.deriveKycStatusFromPayoutProfile(payoutProfile);
    const alatStatus =
      alatProfile?.status || CreatorAlatProfileStatus.NOT_STARTED;
    const canReceiveSettlement =
      payoutStatus === CreatorSettlementProfileStatus.ACTIVE;
    const tierSummary = await this.getKycTierSummary(
      userId,
      kycVerification,
      payoutProfile,
    );
    const canOfferAlatTransfer =
      canReceiveSettlement &&
      tierSummary.kycTier === KycTierDto.FULL &&
      alatStatus === CreatorAlatProfileStatus.ACTIVE &&
      Boolean(alatProfile?.businessId);

    const tasks = this.buildOnboardingTasks(
      payoutStatus,
      kycStatus,
      alatStatus,
      Boolean(alatProfile?.businessId),
      tierSummary.livenessRequired,
      tierSummary.kycTier,
    );
    const nextAction =
      tasks.find((task) => task.status === 'PENDING')?.code || null;

    return {
      hasPaidEvent: Boolean(payoutProfile),
      needsAttention: tasks.some((task) => task.status === 'PENDING'),
      showPersistentAlert: tasks.some(
        (task) => task.status === 'PENDING' && task.blocking,
      ),
      nextAction,
      canReceiveSettlement,
      canOfferAlatTransfer,
      tasks,
      payoutProfileStatus: payoutStatus,
      kycStatus,
      alatProfileStatus: alatStatus,
      ...tierSummary,
    };
  }

  async getKyc(userId: string) {
    const [payoutProfile, kycVerification] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
    ]);

    const accountOwnershipType =
      kycVerification?.accountOwnershipType ||
      payoutProfile?.accountOwnershipType ||
      AccountOwnershipType.UNKNOWN;

    const verification = kycVerification || {
      status: this.deriveKycStatusFromPayoutProfile(payoutProfile),
      accountOwnershipType,
      verificationMode: null,
      businessStatus:
        accountOwnershipType === AccountOwnershipType.BUSINESS
          ? this.deriveKycStatusFromPayoutProfile(payoutProfile)
          : KycVerificationStatus.NOT_STARTED,
      identityStatus: this.deriveKycStatusFromPayoutProfile(payoutProfile),
      livenessStatus: this.deriveKycStatusFromPayoutProfile(payoutProfile),
      amlStatus: this.deriveKycStatusFromPayoutProfile(payoutProfile),
      dedupStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus:
        payoutProfile?.nameMatchStatus ||
        (payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE
          ? NameMatchStatus.MATCHED
          : NameMatchStatus.NOT_CHECKED),
      verifiedFullName: null,
      verifiedBusinessName: null,
      rejectionReason: null,
      metadata: {},
    };

    return this.formatKyc(
      verification,
      payoutProfile,
      await this.getKycTierSummary(userId, verification, payoutProfile),
    );
  }

  async getAccountChanges(userId: string, dto: AccountChangesQueryDto) {
    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;

    const [changes, total] = await Promise.all([
      this.prisma.settlementAccountChange.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.settlementAccountChange.count({
        where: { userId },
      }),
    ]);

    return {
      data: changes.map((change) => this.formatAccountChange(change)),
      page,
      pageSize,
      total,
    };
  }

  async getBanks() {
    const response = await this.paystackService.listBanks('nigeria');

    return {
      data: response.data.map((bank) => ({
        name: bank.name,
        code: bank.code,
        longcode: bank.longcode,
      })),
    };
  }

  async resolvePayoutAccount(userId: string, dto: ResolvePayoutAccountDto) {
    const normalizedBankCode = this.normalizeBankCode(dto.bankCode);
    const normalizedAccountNumber = this.normalizePayoutAccountNumber(
      dto.accountNumber,
    );

    const payoutAccount = this.resolveValidPayoutAccountDetails(
      normalizedBankCode,
      normalizedAccountNumber,
    );
    await this.assertNoDuplicatePayoutAccount(
      userId,
      payoutAccount.bankCode,
      payoutAccount.accountNumber,
    );

    const resolvedAccount = await this.resolvePayoutAccountWithPaystack(
      payoutAccount.bankCode,
      payoutAccount.accountNumber,
    );

    return {
      data: resolvedAccount,
    };
  }

  async getInternalKycQueue(
    dto: InternalKycQueueQueryDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor);

    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;
    const whereClause = this.buildInternalKycQueueWhere(dto);

    const [
      verifications,
      total,
      submittedCount,
      providerPendingCount,
      reviewRequiredCount,
      reviewedCount,
    ] = await Promise.all([
      this.prisma.creatorKycVerification.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              fullName: true,
              email: true,
              createdAt: true,
            },
          },
          settlementProfile: true,
        },
        orderBy: [
          { reviewedAt: 'asc' },
          { submittedAt: 'asc' },
          { updatedAt: 'desc' },
        ],
        skip,
        take: pageSize,
      }),
      this.prisma.creatorKycVerification.count({
        where: whereClause,
      }),
      this.prisma.creatorKycVerification.count({
        where: {
          ...whereClause,
          status: KycVerificationStatus.SUBMITTED,
        },
      }),
      this.prisma.creatorKycVerification.count({
        where: {
          ...whereClause,
          status: KycVerificationStatus.PENDING_PROVIDER,
        },
      }),
      this.prisma.creatorKycVerification.count({
        where: {
          ...whereClause,
          settlementProfile: {
            is: {
              status: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
            },
          },
        },
      }),
      this.prisma.creatorKycVerification.count({
        where: {
          ...whereClause,
          reviewedAt: {
            not: null,
          },
        },
      }),
    ]);

    return {
      data: verifications.map((verification) =>
        this.formatInternalKycQueueItem(verification),
      ),
      total,
      page,
      pageSize,
      summary: {
        submittedCount,
        providerPendingCount,
        reviewRequiredCount,
        reviewedCount,
      },
    };
  }

  async getInternalAlatQueue(
    dto: InternalAlatQueueQueryDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor);

    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;
    const whereClause = this.buildInternalAlatQueueWhere(dto);

    const pendingActivationWhere: Prisma.UserWhereInput = {
      settlementProfile: {
        is: {
          status: CreatorSettlementProfileStatus.ACTIVE,
        },
      },
      OR: [
        {
          alatProfile: {
            is: null,
          },
        },
        {
          alatProfile: {
            is: {
              status: {
                not: CreatorAlatProfileStatus.ACTIVE,
              },
            },
          },
        },
      ],
    };

    const [
      creators,
      total,
      payoutActiveCount,
      pendingActivationCount,
      activeAlatCount,
      rejectedAlatCount,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          createdAt: true,
          settlementProfile: true,
          alatProfile: true,
          _count: {
            select: {
              eventsCreated: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({
        where: whereClause,
      }),
      this.prisma.user.count({
        where: {
          settlementProfile: {
            is: {
              status: CreatorSettlementProfileStatus.ACTIVE,
            },
          },
        },
      }),
      this.prisma.user.count({
        where: pendingActivationWhere,
      }),
      this.prisma.user.count({
        where: {
          alatProfile: {
            is: {
              status: CreatorAlatProfileStatus.ACTIVE,
            },
          },
        },
      }),
      this.prisma.user.count({
        where: {
          alatProfile: {
            is: {
              status: CreatorAlatProfileStatus.REJECTED,
            },
          },
        },
      }),
    ]);

    return {
      data: creators.map((creator) =>
        this.formatInternalAlatQueueItem(creator),
      ),
      total,
      page,
      pageSize,
      summary: {
        payoutActiveCount,
        pendingActivationCount,
        activeAlatCount,
        rejectedAlatCount,
      },
    };
  }

  async handleDikriptWebhook(
    payload: any,
    signature: string,
    rawBody?: Buffer,
  ) {
    const isValid = this.dikriptService.verifyWebhookSignature(
      payload || {},
      rawBody,
      signature,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid Dikript webhook signature');
    }

    const requestId =
      payload?.data?.id ||
      payload?.data?.transactionRef ||
      payload?.transactionRef ||
      payload?.dikriptTransactionRef ||
      payload?.sessionId ||
      payload?.sessionToken;
    if (!requestId) {
      return { received: true, processed: false };
    }

    const verification = await this.prisma.creatorKycVerification.findFirst({
      where: {
        OR: [
          { qoreIdentityCheckId: String(requestId) },
          { qoreBusinessCheckId: String(requestId) },
          { qoreLivenessCheckId: String(requestId) },
          { qoreAmlCheckId: String(requestId) },
        ],
      },
      include: {
        settlementProfile: true,
      },
    });

    if (!verification) {
      return { received: true, processed: false };
    }

    const updateData: Prisma.CreatorKycVerificationUpdateInput = {
      metadata: {
        ...(verification.metadata &&
        typeof verification.metadata === 'object' &&
        !Array.isArray(verification.metadata)
          ? (verification.metadata as Record<string, any>)
          : {}),
        lastWebhook: this.summarizeDikriptWebhookPayload(payload),
      },
    };
    const payoutUpdate: Prisma.CreatorSettlementProfileUpdateInput = {};
    const requestIdString = String(requestId);
    const isIdentityRequest =
      verification.qoreIdentityCheckId === requestIdString;
    const isBusinessRequest =
      verification.qoreBusinessCheckId === requestIdString;
    const isLivenessRequest =
      verification.qoreLivenessCheckId === requestIdString;
    let resolvedNotificationTarget: KycResolutionNotificationTargetDto | null =
      null;
    let resolvedNotificationStatus: KycVerificationStatus | null = null;

    if (
      payload?.event === 'identity' &&
      payload?.event_type === 'verification_completed'
    ) {
      if (
        isIdentityRequest &&
        this.extractIdentityRecord(payload?.data as DikriptNinResponse)
      ) {
        const identityResponse = payload.data as DikriptNinResponse;
        const identityRecord = this.extractIdentityRecord(identityResponse);
        const identityStatus =
          this.resolveDikriptIdentityStatus(identityResponse);
        const verifiedFullName = this.combineNameParts(
          identityRecord?.firstname,
          identityRecord?.middlename,
          identityRecord?.lastname,
        );
        const verifiedDateOfBirth = this.parseDate(
          identityRecord?.birthdate || null,
        );
        const nextWorkflowStatus = this.deriveVerificationWorkflowStatus({
          accountOwnershipType: verification.accountOwnershipType,
          businessStatus: verification.businessStatus,
          identityStatus,
        });
        const nextPayoutState = this.derivePayoutStateFromVerificationStatus(
          nextWorkflowStatus,
          verification.accountOwnershipType,
        );
        const providerSubject = this.extractProviderSubject(identityResponse);
        const duplicateReview = await this.detectDuplicateKycSignals({
          userId: verification.userId,
          providerSubjectHash: this.hashKycSubject(providerSubject),
          businessReferenceHash: verification.businessReferenceHash || null,
          nameDobHash: this.hashNameDob(verifiedFullName, verifiedDateOfBirth),
        });
        let resolvedNameMatchStatus = verification.nameMatchStatus;
        let resolvedNameMatchReason = verification.nameMatchReason;

        updateData.identityStatus = identityStatus;
        updateData.status = nextWorkflowStatus;
        updateData.verifiedFullName = verifiedFullName;
        updateData.verifiedDateOfBirth = verifiedDateOfBirth;
        updateData.nameDobHash = this.hashNameDob(
          verifiedFullName,
          verifiedDateOfBirth,
        );
        updateData.providerSubjectHash = this.hashKycSubject(providerSubject);
        updateData.providerSubjectLast4 = this.getLast4(providerSubject);
        updateData.dedupStatus = duplicateReview.status;
        updateData.metadata = {
          ...((updateData.metadata as Record<string, any>) || {}),
          dedupReview: duplicateReview.metadata,
        };
        if (
          identityStatus === KycVerificationStatus.VERIFIED &&
          verification.accountOwnershipType === AccountOwnershipType.PERSONAL
        ) {
          const nameMatch = this.evaluateSettlementNameMatch({
            accountOwnershipType: AccountOwnershipType.PERSONAL,
            accountName: verification.settlementProfile?.accountName,
            verifiedFullName,
            verifiedBusinessName: null,
          });
          updateData.nameMatchStatus = nameMatch.status;
          updateData.nameMatchScore = nameMatch.score;
          updateData.nameMatchReason = nameMatch.reason;
          resolvedNameMatchStatus = nameMatch.status;
          resolvedNameMatchReason = nameMatch.reason;
          payoutUpdate.nameMatchStatus = nameMatch.status;
          payoutUpdate.rejectionReason =
            nameMatch.status === NameMatchStatus.MISMATCH
              ? 'Payout account name does not match verified identity'
              : nextPayoutState.rejectionReason;
        }
        updateData.rejectionReason =
          identityStatus === KycVerificationStatus.REJECTED
            ? 'Dikript webhook reported failed identity verification'
            : null;
        const basicAutoApproved =
          verification.accountOwnershipType === AccountOwnershipType.PERSONAL &&
          this.canAutoApproveKycTier({
            targetTier: KycTierDto.BASIC,
            accountOwnershipType: AccountOwnershipType.PERSONAL,
            identityStatus,
            nameMatchStatus: resolvedNameMatchStatus,
            dedupStatus: duplicateReview.status,
          });
        const manualReviewReason =
          verification.accountOwnershipType === AccountOwnershipType.PERSONAL &&
          identityStatus === KycVerificationStatus.VERIFIED &&
          !basicAutoApproved
            ? this.getKycManualReviewReason({
                nameMatchStatus: resolvedNameMatchStatus,
                nameMatchReason: resolvedNameMatchReason,
                duplicateReason: duplicateReview.reason,
                mismatchReason:
                  'Payout account name does not match verified identity',
                reviewReason:
                  'Payout account name needs manual review before Basic KYC can be approved.',
              })
            : null;
        const resolvedPayoutState = basicAutoApproved
          ? {
              kycStatus: KycVerificationStatus.VERIFIED,
              profileStatus: CreatorSettlementProfileStatus.ACTIVE,
              rejectionReason: null,
            }
          : manualReviewReason
            ? {
                kycStatus: KycVerificationStatus.SUBMITTED,
                profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
                rejectionReason: manualReviewReason,
              }
            : nextPayoutState;

        if (basicAutoApproved || manualReviewReason) {
          const approvedTier = basicAutoApproved
            ? KycTierDto.BASIC
            : KycTierDto.NONE;

          updateData.status = basicAutoApproved
            ? KycVerificationStatus.VERIFIED
            : KycVerificationStatus.SUBMITTED;
          updateData.submittedAt = manualReviewReason ? new Date() : null;
          updateData.reviewedAt = null;
          updateData.rejectionReason = manualReviewReason;
          updateData.metadata = {
            ...this.normalizeJsonObject(updateData.metadata),
            kycTier: approvedTier,
            approvedTier,
            targetTier: KycTierDto.BASIC,
          };
          payoutUpdate.approvedAt = basicAutoApproved
            ? verification.settlementProfile?.approvedAt || new Date()
            : null;
          payoutUpdate.rejectedAt = null;
          payoutUpdate.metadata = {
            ...this.normalizeJsonObject(
              verification.settlementProfile?.metadata,
            ),
            kycTier: approvedTier,
            approvedTier,
          };
        }

        payoutUpdate.kycStatus = resolvedPayoutState.kycStatus;
        payoutUpdate.status = resolvedPayoutState.profileStatus;
        payoutUpdate.rejectionReason =
          payoutUpdate.rejectionReason ?? resolvedPayoutState.rejectionReason;
        resolvedNotificationTarget =
          KycResolutionNotificationTargetDto.IDENTITY;
        resolvedNotificationStatus = identityStatus;
      } else if (payload?.data?.cac && isBusinessRequest) {
        const businessResponse = payload.data as DikriptCacResponse;
        const businessStatus =
          this.resolveDikriptBusinessStatus(businessResponse);
        const nextWorkflowStatus = this.deriveVerificationWorkflowStatus({
          accountOwnershipType: verification.accountOwnershipType,
          businessStatus,
          identityStatus: verification.identityStatus,
        });
        const nextPayoutState = this.derivePayoutStateFromVerificationStatus(
          nextWorkflowStatus,
          verification.accountOwnershipType,
        );
        const businessReference = businessResponse.cac?.rcNumber || null;
        const duplicateReview = await this.detectDuplicateKycSignals({
          userId: verification.userId,
          businessReferenceHash: this.hashKycSubject(businessReference),
          providerSubjectHash: verification.providerSubjectHash || null,
        });
        let resolvedNameMatchStatus = verification.nameMatchStatus;
        let resolvedNameMatchReason = verification.nameMatchReason;

        updateData.businessStatus = businessStatus;
        updateData.status = nextWorkflowStatus;
        updateData.businessReferenceHash =
          this.hashKycSubject(businessReference);
        updateData.businessReferenceLast4 = this.getLast4(businessReference);
        updateData.dedupStatus = duplicateReview.status;
        updateData.verifiedBusinessName =
          businessResponse.cac?.companyName ||
          verification.verifiedBusinessName;
        if (businessStatus === KycVerificationStatus.VERIFIED) {
          const nameMatch = this.evaluateSettlementNameMatch({
            accountOwnershipType: AccountOwnershipType.BUSINESS,
            accountName: verification.settlementProfile?.accountName,
            verifiedFullName: null,
            verifiedBusinessName:
              businessResponse.cac?.companyName ||
              verification.verifiedBusinessName,
          });
          updateData.nameMatchStatus = nameMatch.status;
          updateData.nameMatchScore = nameMatch.score;
          updateData.nameMatchReason = nameMatch.reason;
          resolvedNameMatchStatus = nameMatch.status;
          resolvedNameMatchReason = nameMatch.reason;
          payoutUpdate.nameMatchStatus = nameMatch.status;
          payoutUpdate.rejectionReason =
            nameMatch.status === NameMatchStatus.MISMATCH
              ? 'Payout account name does not match verified business'
              : nextPayoutState.rejectionReason;
        }
        updateData.metadata = {
          ...((updateData.metadata as Record<string, any>) || {}),
          dedupReview: duplicateReview.metadata,
        };
        updateData.rejectionReason =
          businessStatus === KycVerificationStatus.REJECTED
            ? 'Dikript webhook reported failed business verification'
            : null;
        const basicAutoApproved =
          verification.accountOwnershipType === AccountOwnershipType.BUSINESS &&
          this.canAutoApproveKycTier({
            targetTier: KycTierDto.BASIC,
            accountOwnershipType: AccountOwnershipType.BUSINESS,
            businessStatus,
            nameMatchStatus: resolvedNameMatchStatus,
            dedupStatus: duplicateReview.status,
          });
        const manualReviewReason =
          verification.accountOwnershipType === AccountOwnershipType.BUSINESS &&
          businessStatus === KycVerificationStatus.VERIFIED &&
          !basicAutoApproved
            ? this.getKycManualReviewReason({
                nameMatchStatus: resolvedNameMatchStatus,
                nameMatchReason: resolvedNameMatchReason,
                duplicateReason: duplicateReview.reason,
                mismatchReason:
                  'Payout account name does not match verified business',
                reviewReason:
                  'Payout account name needs manual review before Basic KYC can be approved.',
              })
            : null;
        const resolvedPayoutState = basicAutoApproved
          ? {
              kycStatus: KycVerificationStatus.VERIFIED,
              profileStatus: CreatorSettlementProfileStatus.ACTIVE,
              rejectionReason: null,
            }
          : manualReviewReason
            ? {
                kycStatus: KycVerificationStatus.SUBMITTED,
                profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
                rejectionReason: manualReviewReason,
              }
            : nextPayoutState;

        if (basicAutoApproved || manualReviewReason) {
          const approvedTier = basicAutoApproved
            ? KycTierDto.BASIC
            : KycTierDto.NONE;

          updateData.status = basicAutoApproved
            ? KycVerificationStatus.VERIFIED
            : KycVerificationStatus.SUBMITTED;
          updateData.submittedAt = manualReviewReason ? new Date() : null;
          updateData.reviewedAt = null;
          updateData.rejectionReason = manualReviewReason;
          updateData.metadata = {
            ...this.normalizeJsonObject(updateData.metadata),
            kycTier: approvedTier,
            approvedTier,
            targetTier: KycTierDto.BASIC,
          };
          payoutUpdate.approvedAt = basicAutoApproved
            ? verification.settlementProfile?.approvedAt || new Date()
            : null;
          payoutUpdate.rejectedAt = null;
          payoutUpdate.metadata = {
            ...this.normalizeJsonObject(
              verification.settlementProfile?.metadata,
            ),
            kycTier: approvedTier,
            approvedTier,
          };
        }

        payoutUpdate.kycStatus = resolvedPayoutState.kycStatus;
        payoutUpdate.status = resolvedPayoutState.profileStatus;
        payoutUpdate.rejectionReason =
          payoutUpdate.rejectionReason ?? resolvedPayoutState.rejectionReason;
        resolvedNotificationTarget =
          KycResolutionNotificationTargetDto.BUSINESS;
        resolvedNotificationStatus = businessStatus;
      }
    }

    if (
      isLivenessRequest &&
      (payload?.data?.face_verification ||
        payload?.data?.summary?.face_verification_check)
    ) {
      const faceVerificationResponse =
        payload.data as DikriptFaceVerificationResponse;
      const livenessStatus = this.resolveDikriptFaceVerificationStatus(
        faceVerificationResponse,
      );
      const nextWorkflowStatus = this.deriveVerificationWorkflowStatus({
        accountOwnershipType: verification.accountOwnershipType,
        businessStatus: verification.businessStatus,
        identityStatus: verification.identityStatus,
        livenessStatus,
      });
      const nextPayoutState = this.derivePayoutStateFromVerificationStatus(
        nextWorkflowStatus,
        verification.accountOwnershipType,
        livenessStatus,
      );
      const existingTier = this.resolveKycTier(
        verification,
        verification.settlementProfile,
      );
      const shouldPreserveBasicTier =
        existingTier === KycTierDto.BASIC &&
        verification.status === KycVerificationStatus.VERIFIED &&
        verification.settlementProfile?.status ===
          CreatorSettlementProfileStatus.ACTIVE;
      const fullUpgradePassed =
        shouldPreserveBasicTier &&
        this.canAutoApproveKycTier({
          targetTier: KycTierDto.FULL,
          accountOwnershipType: verification.accountOwnershipType,
          businessStatus: verification.businessStatus,
          identityStatus: verification.identityStatus,
          livenessStatus,
          nameMatchStatus: verification.nameMatchStatus,
          dedupStatus: verification.dedupStatus,
        });
      const fullReviewRequired =
        shouldPreserveBasicTier &&
        livenessStatus === KycVerificationStatus.VERIFIED &&
        !fullUpgradePassed;
      const nextTier = fullUpgradePassed ? KycTierDto.FULL : existingTier;
      const metadata = this.normalizeJsonObject(updateData.metadata);

      updateData.livenessStatus = livenessStatus;
      updateData.status = fullUpgradePassed
        ? KycVerificationStatus.VERIFIED
        : fullReviewRequired
          ? KycVerificationStatus.SUBMITTED
          : shouldPreserveBasicTier
            ? verification.status
            : nextWorkflowStatus;
      updateData.rejectionReason =
        livenessStatus === KycVerificationStatus.REJECTED
          ? 'Dikript webhook reported failed face verification'
          : fullReviewRequired
            ? 'Full KYC needs manual review before the tier can be upgraded.'
            : null;
      updateData.submittedAt = fullReviewRequired
        ? new Date()
        : verification.submittedAt;
      updateData.reviewedAt = fullReviewRequired
        ? null
        : verification.reviewedAt;
      updateData.metadata = {
        ...metadata,
        kycTier: nextTier,
        approvedTier: nextTier,
        targetTier: KycTierDto.FULL,
      };

      payoutUpdate.kycStatus =
        fullUpgradePassed || shouldPreserveBasicTier
          ? KycVerificationStatus.VERIFIED
          : nextPayoutState.kycStatus;
      payoutUpdate.status =
        fullUpgradePassed || shouldPreserveBasicTier
          ? CreatorSettlementProfileStatus.ACTIVE
          : nextPayoutState.profileStatus;
      payoutUpdate.rejectionReason = shouldPreserveBasicTier
        ? null
        : nextPayoutState.rejectionReason;
      payoutUpdate.metadata = {
        ...this.normalizeJsonObject(verification.settlementProfile?.metadata),
        kycTier: nextTier,
        approvedTier: nextTier,
      };
      resolvedNotificationTarget = KycResolutionNotificationTargetDto.LIVENESS;
      resolvedNotificationStatus = livenessStatus;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.creatorKycVerification.update({
        where: { id: verification.id },
        data: updateData,
      });

      if (Object.keys(payoutUpdate).length > 0) {
        await tx.creatorSettlementProfile.update({
          where: { id: verification.settlementProfileId },
          data: payoutUpdate,
        });
      }
    });

    if (Object.keys(payoutUpdate).length > 0) {
      const nextProfileStatus =
        (payoutUpdate.status as CreatorSettlementProfileStatus) ||
        verification.settlementProfile.status;
      await this.syncCreatorSettlementStatus(
        verification.userId,
        nextProfileStatus,
      );
    }

    if (
      resolvedNotificationTarget &&
      resolvedNotificationStatus &&
      resolvedNotificationStatus !== KycVerificationStatus.PENDING_PROVIDER
    ) {
      const latestVerification =
        await this.prisma.creatorKycVerification.findUnique({
          where: { id: verification.id },
        });

      if (latestVerification) {
        await this.sendQueuedKycResolutionNotification(
          latestVerification,
          resolvedNotificationTarget,
          requestIdString,
          resolvedNotificationStatus,
        );
      }
    }

    return { received: true, processed: true };
  }

  async getAlatProfile(userId: string) {
    const profile = await this.prisma.creatorAlatProfile.findUnique({
      where: { userId },
    });

    return profile ? this.formatAlatProfile(profile) : null;
  }

  async upsertPayoutProfile(userId: string, dto: UpsertPayoutProfileDto) {
    const normalizedBankCode = this.normalizeBankCode(dto.bankCode);
    const normalizedAccountNumber = this.normalizePayoutAccountNumber(
      dto.accountNumber,
    );
    const payoutAccount = this.resolveValidPayoutAccountDetails(
      normalizedBankCode,
      normalizedAccountNumber,
    );
    const [existingProfile, existingVerification] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
    ]);

    await this.assertNoDuplicatePayoutAccount(
      userId,
      payoutAccount.bankCode,
      payoutAccount.accountNumber,
    );

    const ownershipType = dto.accountOwnershipType as AccountOwnershipType;
    const canReusePayoutVerification = this.canReusePayoutVerification(
      existingProfile,
      ownershipType,
      payoutAccount.bankCode,
      payoutAccount.accountNumber,
    );
    const accountResolution = canReusePayoutVerification
      ? null
      : await this.resolvePayoutAccountWithPaystack(
          payoutAccount.bankCode,
          payoutAccount.accountNumber,
        );
    const resolvedAccountName =
      accountResolution?.accountName ||
      (canReusePayoutVerification ? existingProfile?.accountName : null) ||
      null;
    const resolvedLegalName =
      ownershipType === AccountOwnershipType.PERSONAL
        ? resolvedAccountName
        : null;
    const resolvedBusinessName =
      ownershipType === AccountOwnershipType.BUSINESS
        ? resolvedAccountName
        : null;
    const resolvedStatus = CreatorSettlementProfileStatus.ACCOUNT_VERIFIED;

    const criticalFieldsChanged =
      !!existingProfile &&
      (existingProfile.accountNumber !== payoutAccount.accountNumber ||
        existingProfile.bankName !== dto.bankName ||
        existingProfile.bankCode !== payoutAccount.bankCode ||
        existingProfile.accountName !== resolvedAccountName ||
        existingProfile.accountOwnershipType !== ownershipType);
    const ownershipTypeChanged =
      !!existingProfile &&
      existingProfile.accountOwnershipType !== ownershipType;
    const existingProfileMetadata = this.normalizeJsonObject(
      existingProfile?.metadata,
    );
    const nextProfileMetadata = {
      ...existingProfileMetadata,
      accountNameConfirmation: this.buildPayoutAccountConfirmation({
        accountName: resolvedAccountName,
        bankCode: payoutAccount.bankCode,
        accountNumber: payoutAccount.accountNumber,
      }),
      paystack: accountResolution
        ? this.summarizePaystackAccountResolution(accountResolution)
        : existingProfileMetadata.paystack || null,
      dikript: existingProfileMetadata.dikript || null,
      verificationCost: {
        ...this.normalizeJsonObject(existingProfileMetadata.verificationCost),
        payoutAccount: {
          provider: 'PAYSTACK',
          reused: canReusePayoutVerification,
          charged: false,
          accountHash: this.hashKycSubject(payoutAccount.accountNumber),
          checkedAt: new Date().toISOString(),
        },
      },
    };
    const recalculatedNameMatch =
      existingVerification && !ownershipTypeChanged
        ? this.evaluateSettlementNameMatch({
            accountOwnershipType: ownershipType,
            accountName: resolvedAccountName,
            verifiedFullName: existingVerification.verifiedFullName,
            verifiedBusinessName: existingVerification.verifiedBusinessName,
          })
        : null;

    const nextStatus =
      existingProfile?.status === CreatorSettlementProfileStatus.ACTIVE &&
      !criticalFieldsChanged
        ? CreatorSettlementProfileStatus.ACTIVE
        : resolvedStatus;

    const nextKycStatus =
      ownershipTypeChanged || !existingProfile?.kycStatus
        ? KycVerificationStatus.NOT_STARTED
        : criticalFieldsChanged && existingVerification
          ? KycVerificationStatus.IN_PROGRESS
          : existingProfile.kycStatus;

    const nextNameMatchStatus = ownershipTypeChanged
      ? NameMatchStatus.NOT_CHECKED
      : recalculatedNameMatch?.status ||
        existingProfile?.nameMatchStatus ||
        NameMatchStatus.NOT_CHECKED;

    const profile = await this.prisma.creatorSettlementProfile.upsert({
      where: { userId },
      update: {
        businessName: resolvedBusinessName,
        legalName: resolvedLegalName,
        accountOwnershipType: ownershipType,
        bankName: dto.bankName,
        bankCode: payoutAccount.bankCode,
        accountName: resolvedAccountName,
        accountNumber: payoutAccount.accountNumber,
        accountNumberMasked: this.maskAccountNumber(
          payoutAccount.accountNumber,
        ),
        bvnLast4: null,
        accountVerifiedAt: canReusePayoutVerification
          ? existingProfile?.accountVerifiedAt || new Date()
          : new Date(),
        kycStatus: nextKycStatus,
        nameMatchStatus: nextNameMatchStatus,
        status: nextStatus,
        metadata: nextProfileMetadata,
        submittedAt: new Date(),
        approvedAt:
          nextStatus === CreatorSettlementProfileStatus.ACTIVE
            ? existingProfile?.approvedAt || new Date()
            : null,
        rejectedAt: null,
        rejectionReason: null,
      },
      create: {
        userId,
        businessName: resolvedBusinessName,
        legalName: resolvedLegalName,
        accountOwnershipType: ownershipType,
        bankName: dto.bankName,
        bankCode: payoutAccount.bankCode,
        accountName: resolvedAccountName,
        accountNumber: payoutAccount.accountNumber,
        accountNumberMasked: this.maskAccountNumber(
          payoutAccount.accountNumber,
        ),
        bvnLast4: null,
        accountVerifiedAt: new Date(),
        kycStatus: KycVerificationStatus.NOT_STARTED,
        nameMatchStatus: NameMatchStatus.NOT_CHECKED,
        status: resolvedStatus,
        submittedAt: new Date(),
        metadata: nextProfileMetadata,
      },
    });

    await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: ownershipType,
        verificationMode:
          ownershipTypeChanged && existingProfile ? null : undefined,
        businessStatus:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        identityStatus:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        livenessStatus:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        amlStatus:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        dedupStatus:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        status:
          ownershipTypeChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : criticalFieldsChanged && existingVerification
              ? KycVerificationStatus.IN_PROGRESS
              : undefined,
        nameMatchStatus:
          ownershipTypeChanged && existingProfile
            ? NameMatchStatus.NOT_CHECKED
            : recalculatedNameMatch
              ? recalculatedNameMatch.status
              : undefined,
        nameMatchScore:
          ownershipTypeChanged && existingProfile
            ? null
            : recalculatedNameMatch
              ? recalculatedNameMatch.score
              : undefined,
        nameMatchReason:
          ownershipTypeChanged && existingProfile
            ? null
            : recalculatedNameMatch
              ? recalculatedNameMatch.reason
              : undefined,
        identityType:
          ownershipTypeChanged && existingProfile ? null : undefined,
        identityReferenceMasked:
          ownershipTypeChanged && existingProfile ? null : undefined,
        identityReferenceLast4:
          ownershipTypeChanged && existingProfile ? null : undefined,
        providerSubjectHash:
          ownershipTypeChanged && existingProfile ? null : undefined,
        providerSubjectLast4:
          ownershipTypeChanged && existingProfile ? null : undefined,
        businessReferenceHash:
          ownershipTypeChanged && existingProfile ? null : undefined,
        businessReferenceLast4:
          ownershipTypeChanged && existingProfile ? null : undefined,
        nameDobHash: ownershipTypeChanged && existingProfile ? null : undefined,
        verifiedFullName:
          ownershipTypeChanged && existingProfile ? null : undefined,
        verifiedBusinessName:
          ownershipTypeChanged && existingProfile ? null : undefined,
        verifiedDateOfBirth:
          ownershipTypeChanged && existingProfile ? null : undefined,
        qoreBusinessCheckId:
          ownershipTypeChanged && existingProfile ? null : undefined,
        qoreIdentityCheckId:
          ownershipTypeChanged && existingProfile ? null : undefined,
        qoreLivenessCheckId:
          ownershipTypeChanged && existingProfile ? null : undefined,
        metadata: existingVerification
          ? {
              ...this.normalizeJsonObject(existingVerification.metadata),
              flow: {
                ...this.normalizeJsonObject(
                  this.normalizeJsonObject(existingVerification.metadata).flow,
                ),
                ownershipTypeChanged,
                payoutAccountChanged: criticalFieldsChanged,
                accountNameMatchRecheckedAt: recalculatedNameMatch
                  ? new Date().toISOString()
                  : null,
              },
            }
          : undefined,
      },
      create: {
        userId,
        settlementProfileId: profile.id,
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: ownershipType,
      },
    });

    if (existingProfile && criticalFieldsChanged) {
      await this.prisma.settlementAccountChange.create({
        data: {
          userId,
          settlementProfileId: existingProfile.id,
          previousBankName: existingProfile.bankName,
          previousBankCode: existingProfile.bankCode,
          previousAccountNumberMasked:
            existingProfile.accountNumberMasked ||
            this.maskAccountNumber(existingProfile.accountNumber),
          previousAccountName: existingProfile.accountName,
          previousOwnershipType: existingProfile.accountOwnershipType,
          newBankName: dto.bankName,
          newBankCode: payoutAccount.bankCode,
          newAccountNumberMasked: this.maskAccountNumber(
            payoutAccount.accountNumber,
          ),
          newAccountName: resolvedAccountName,
          newOwnershipType: ownershipType,
          nameChanged: existingProfile.accountName !== resolvedAccountName,
          ownershipTypeChanged:
            existingProfile.accountOwnershipType !== ownershipType,
          changedBy: 'USER',
          reason: 'Creator updated payout account in app',
        },
      });
    }

    if (criticalFieldsChanged) {
      await this.prisma.creatorAlatProfile.upsert({
        where: { userId },
        update: {
          status: CreatorAlatProfileStatus.PENDING_REVIEW,
          accountNumber: payoutAccount.accountNumber,
          accountName: resolvedAccountName,
          displayName: this.buildAlatDisplayName(resolvedAccountName),
          activatedAt: null,
          deactivatedAt: new Date(),
          reviewedAt: new Date(),
          notes:
            'Payout destination changed. Review and reprovision ALAT profile before reactivating transfer.',
        },
        create: {
          userId,
          status: CreatorAlatProfileStatus.PENDING_REVIEW,
          accountNumber: payoutAccount.accountNumber,
          accountName: resolvedAccountName,
          displayName: this.buildAlatDisplayName(resolvedAccountName),
          deactivatedAt: new Date(),
          reviewedAt: new Date(),
          notes:
            'Payout destination changed. Review and reprovision ALAT profile before activating transfer.',
        },
      });
    }

    await this.syncCreatorSettlementStatus(userId, profile.status);

    return this.formatPayoutProfile(profile);
  }

  async confirmPayoutProfile(userId: string) {
    const profile = await this.prisma.creatorSettlementProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundException('Payout profile not found');
    }

    if (
      profile.status === CreatorSettlementProfileStatus.NOT_STARTED ||
      !profile.accountVerifiedAt ||
      !profile.accountName
    ) {
      throw new BadRequestException(
        'A verified payout account is required before account name confirmation',
      );
    }

    const metadata = this.normalizeJsonObject(profile.metadata);
    const updatedProfile = await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        metadata: {
          ...metadata,
          accountNameConfirmation: {
            confirmedAt: new Date().toISOString(),
            accountName: profile.accountName,
            bankCode: profile.bankCode,
            accountNumberHash: this.hashKycSubject(profile.accountNumber),
          },
        },
      },
    });

    return this.formatPayoutProfile(updatedProfile);
  }

  async reviewPayoutProfile(
    targetUserId: string,
    dto: ReviewPayoutProfileDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);

    const existingProfile =
      await this.prisma.creatorSettlementProfile.findUnique({
        where: { userId: targetUserId },
      });

    if (!existingProfile) {
      throw new NotFoundException('Payout profile not found');
    }

    const nextStatus = dto.status as CreatorSettlementProfileStatus;

    const updatedProfile = await this.prisma.creatorSettlementProfile.update({
      where: { userId: targetUserId },
      data: {
        status: nextStatus,
        approvedAt:
          nextStatus === CreatorSettlementProfileStatus.ACTIVE
            ? new Date()
            : null,
        rejectedAt:
          nextStatus === CreatorSettlementProfileStatus.REJECTED
            ? new Date()
            : null,
        rejectionReason: dto.rejectionReason || null,
      },
    });

    await this.syncCreatorSettlementStatus(targetUserId, nextStatus);

    return this.formatPayoutProfile(updatedProfile);
  }

  async startPersonalKyc(userId: string, dto: StartPersonalKycDto) {
    const [payoutProfile, existingVerification, user] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          fullName: true,
          phoneNumber: true,
          email: true,
          gender: true,
        },
      }),
    ]);

    if (!payoutProfile) {
      throw new NotFoundException('Payout profile not found');
    }

    await this.assertNoDuplicatePayoutAccount(
      userId,
      payoutProfile.bankCode,
      payoutProfile.accountNumber,
    );

    if (!this.hasVerifiedPayoutAccount(payoutProfile)) {
      throw new BadRequestException(
        'Add a verified payout account before starting identity verification',
      );
    }

    const resolvedNames = this.resolveIdentityNames(
      dto.firstName,
      dto.lastName,
      payoutProfile.legalName ||
        user?.fullName ||
        payoutProfile.accountName ||
        null,
    );

    if (!resolvedNames) {
      throw new BadRequestException(
        'A legal name or first and last name is required for personal KYC',
      );
    }

    const verificationMode = this.resolvePersonalVerificationMode(dto);
    const identityReference = this.resolveIdentityReferenceFromMode(
      verificationMode,
      dto,
    );
    this.assertIdentityReferenceIsLocallyValid(
      verificationMode,
      identityReference,
    );
    const identityInputHash = this.hashVerificationInput(
      'personalIdentity',
      verificationMode,
      identityReference,
    );
    const cachedIdentity = this.getCachedVerificationAttempt(
      existingVerification?.metadata,
      'personalIdentity',
      identityInputHash,
    );
    let identityStatus =
      cachedIdentity && existingVerification
        ? existingVerification.identityStatus
        : KycVerificationStatus.NOT_STARTED;
    let identityRecord: any = null;
    let verifiedFullName =
      cachedIdentity && existingVerification
        ? existingVerification.verifiedFullName
        : null;
    let verifiedDateOfBirth =
      cachedIdentity && existingVerification
        ? existingVerification.verifiedDateOfBirth
        : null;
    let providerSubject: string | null = null;
    let identityResponse: DikriptNinResponse | null = null;

    if (!cachedIdentity) {
      identityResponse = await this.verifyPersonalIdentityWithDikript({
        verificationMode,
        dto,
        resolvedNames,
        user,
      });

      if (!identityResponse) {
        throw new BadRequestException(
          'NIN, BVN, or phone number is required for personal KYC',
        );
      }

      identityStatus = this.resolveDikriptIdentityStatus(identityResponse);
      identityRecord = this.extractIdentityRecord(identityResponse);
      verifiedFullName = this.combineNameParts(
        identityRecord?.firstname,
        identityRecord?.middlename,
        identityRecord?.lastname,
      );
      verifiedDateOfBirth = this.parseDate(
        identityRecord?.birthdate || dto.dateOfBirth || null,
      );
      providerSubject = this.extractProviderSubject(identityResponse);
    }

    const identityType = this.resolveIdentityTypeFromMode(verificationMode);
    const providerSubjectHash = cachedIdentity
      ? existingVerification?.providerSubjectHash || null
      : this.hashKycSubject(providerSubject);
    const providerSubjectLast4 = cachedIdentity
      ? existingVerification?.providerSubjectLast4 || null
      : this.getLast4(providerSubject);
    const nameDobHash = this.hashNameDob(verifiedFullName, verifiedDateOfBirth);
    const duplicateReview = cachedIdentity
      ? {
          status:
            existingVerification?.dedupStatus ||
            KycVerificationStatus.NOT_STARTED,
          reason: null,
          metadata: this.normalizeJsonObject(
            this.normalizeJsonObject(existingVerification?.metadata)
              .dedupReview,
          ),
        }
      : await this.detectDuplicateKycSignals({
          userId,
          providerSubjectHash,
          nameDobHash,
        });
    const nameMatch =
      identityStatus === KycVerificationStatus.VERIFIED
        ? this.evaluateSettlementNameMatch({
            accountOwnershipType: AccountOwnershipType.PERSONAL,
            accountName: payoutProfile.accountName,
            verifiedFullName,
            verifiedBusinessName: null,
          })
        : {
            status: NameMatchStatus.NOT_CHECKED,
            score: 0,
            reason: 'Identity verification has not passed yet',
          };
    const basicAutoApproved = this.canAutoApproveKycTier({
      targetTier: KycTierDto.BASIC,
      accountOwnershipType: AccountOwnershipType.PERSONAL,
      identityStatus,
      nameMatchStatus: nameMatch.status,
      dedupStatus: duplicateReview.status,
    });
    const manualReviewReason =
      identityStatus === KycVerificationStatus.VERIFIED && !basicAutoApproved
        ? this.getKycManualReviewReason({
            nameMatchStatus: nameMatch.status,
            nameMatchReason: nameMatch.reason,
            duplicateReason: duplicateReview.reason,
            mismatchReason:
              'Payout account name does not match verified identity',
            reviewReason:
              'Payout account name needs manual review before Basic KYC can be approved.',
          })
        : null;
    const nextVerificationStatus =
      identityStatus === KycVerificationStatus.REJECTED
        ? KycVerificationStatus.REJECTED
        : identityStatus === KycVerificationStatus.PENDING_PROVIDER
          ? KycVerificationStatus.PENDING_PROVIDER
          : basicAutoApproved
            ? KycVerificationStatus.VERIFIED
            : manualReviewReason
              ? KycVerificationStatus.SUBMITTED
              : KycVerificationStatus.IN_PROGRESS;
    const payoutState = basicAutoApproved
      ? {
          kycStatus: KycVerificationStatus.VERIFIED,
          profileStatus: CreatorSettlementProfileStatus.ACTIVE,
          rejectionReason: null,
        }
      : manualReviewReason
        ? {
            kycStatus: KycVerificationStatus.SUBMITTED,
            profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
            rejectionReason: manualReviewReason,
          }
        : this.derivePayoutStateFromVerificationStatus(
            identityStatus === KycVerificationStatus.VERIFIED
              ? KycVerificationStatus.IN_PROGRESS
              : identityStatus,
            AccountOwnershipType.PERSONAL,
          );
    const approvedTier = basicAutoApproved ? KycTierDto.BASIC : KycTierDto.NONE;
    const kycSubmittedAt = manualReviewReason ? new Date() : null;

    const verification = await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: AccountOwnershipType.PERSONAL,
        verificationMode,
        phoneNumber: dto.phoneNumber || user?.phoneNumber || undefined,
        identityType,
        identityReferenceMasked: this.maskIdentityReference(identityReference),
        identityReferenceLast4: this.getLast4(identityReference),
        providerSubjectHash,
        providerSubjectLast4,
        businessReferenceHash: null,
        businessReferenceLast4: null,
        businessStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        qoreLivenessCheckId: null,
        dedupStatus: duplicateReview.status,
        nameMatchStatus: nameMatch.status,
        nameMatchScore: nameMatch.score,
        nameMatchReason: nameMatch.reason,
        status: nextVerificationStatus,
        identityStatus,
        verifiedFullName,
        verifiedDateOfBirth,
        nameDobHash,
        submittedAt: kycSubmittedAt,
        reviewedAt: null,
        qoreIdentityCheckId: identityResponse
          ? String(identityResponse.id)
          : existingVerification?.qoreIdentityCheckId || null,
        rejectionReason:
          identityStatus === KycVerificationStatus.REJECTED
            ? 'Dikript could not verify the submitted personal identity details'
            : manualReviewReason,
        metadata: {
          ...(await this.getKycMetadata(userId)),
          kycTier: approvedTier,
          approvedTier,
          targetTier: KycTierDto.BASIC,
          personalDraft: {
            firstName: resolvedNames.firstName,
            lastName: resolvedNames.lastName,
            dateOfBirth: dto.dateOfBirth || null,
          },
          dedupReview: duplicateReview.metadata,
          dikriptIdentity: identityResponse
            ? this.summarizeDikriptIdentityResponse(identityResponse, {
                verificationMode,
                identityType,
              })
            : this.normalizeJsonObject(existingVerification?.metadata)
                .dikriptIdentity || null,
          verificationCache: this.mergeVerificationCache(
            existingVerification?.metadata,
            'personalIdentity',
            {
              inputHash: identityInputHash,
              provider: 'DIKRIPT',
              requestId: identityResponse
                ? String(identityResponse.id)
                : existingVerification?.qoreIdentityCheckId || null,
              status: identityStatus,
              reused: Boolean(cachedIdentity),
              charged: !cachedIdentity,
              checkedAt: new Date().toISOString(),
            },
          ),
        },
      },
      create: {
        userId,
        settlementProfileId: payoutProfile.id,
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: AccountOwnershipType.PERSONAL,
        verificationMode,
        phoneNumber: dto.phoneNumber || user?.phoneNumber || null,
        identityType,
        identityReferenceMasked: this.maskIdentityReference(identityReference),
        identityReferenceLast4: this.getLast4(identityReference),
        providerSubjectHash,
        providerSubjectLast4,
        businessReferenceHash: null,
        businessReferenceLast4: null,
        businessStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        dedupStatus: duplicateReview.status,
        nameMatchStatus: nameMatch.status,
        nameMatchScore: nameMatch.score,
        nameMatchReason: nameMatch.reason,
        status: nextVerificationStatus,
        identityStatus,
        verifiedFullName,
        verifiedDateOfBirth,
        nameDobHash,
        submittedAt: kycSubmittedAt,
        reviewedAt: null,
        qoreIdentityCheckId: identityResponse
          ? String(identityResponse.id)
          : null,
        rejectionReason:
          identityStatus === KycVerificationStatus.REJECTED
            ? 'Dikript could not verify the submitted personal identity details'
            : manualReviewReason,
        metadata: {
          kycTier: approvedTier,
          approvedTier,
          targetTier: KycTierDto.BASIC,
          personalDraft: {
            firstName: resolvedNames.firstName,
            lastName: resolvedNames.lastName,
            dateOfBirth: dto.dateOfBirth || null,
          },
          dedupReview: duplicateReview.metadata,
          dikriptIdentity: identityResponse
            ? this.summarizeDikriptIdentityResponse(identityResponse, {
                verificationMode,
                identityType,
              })
            : null,
          verificationCache: this.mergeVerificationCache(
            null,
            'personalIdentity',
            {
              inputHash: identityInputHash,
              provider: 'DIKRIPT',
              requestId: identityResponse ? String(identityResponse.id) : null,
              status: identityStatus,
              reused: Boolean(cachedIdentity),
              charged: !cachedIdentity,
              checkedAt: new Date().toISOString(),
            },
          ),
        },
      },
    });

    const updatedPayoutProfile =
      await this.prisma.creatorSettlementProfile.update({
        where: { userId },
        data: {
          accountOwnershipType: AccountOwnershipType.PERSONAL,
          kycStatus: payoutState.kycStatus,
          status: payoutState.profileStatus,
          nameMatchStatus: nameMatch.status,
          approvedAt: basicAutoApproved
            ? payoutProfile.approvedAt || new Date()
            : null,
          rejectedAt: null,
          rejectionReason: payoutState.rejectionReason,
          metadata: {
            ...this.normalizeJsonObject(payoutProfile.metadata),
            kycTier: approvedTier,
            approvedTier,
          },
        },
      });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(
      verification,
      updatedPayoutProfile,
      await this.getKycTierSummary(userId, verification, updatedPayoutProfile),
    );
  }

  async submitPersonalLiveness(userId: string, dto: PersonalLivenessDto) {
    const [existingVerification, payoutProfile] = await Promise.all([
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
    ]);

    if (!existingVerification || !payoutProfile) {
      throw new NotFoundException('KYC profile not found');
    }

    if (
      existingVerification.livenessStatus === KycVerificationStatus.VERIFIED
    ) {
      return this.formatKyc(
        existingVerification,
        payoutProfile,
        await this.getKycTierSummary(
          userId,
          existingVerification,
          payoutProfile,
        ),
      );
    }

    if (
      existingVerification.livenessStatus ===
      KycVerificationStatus.PENDING_PROVIDER
    ) {
      throw new BadRequestException(
        'Face verification is already pending provider response',
      );
    }

    const tierSummary = await this.getKycTierSummary(
      userId,
      existingVerification,
      payoutProfile,
    );

    if (
      payoutProfile.status !== CreatorSettlementProfileStatus.ACTIVE ||
      this.resolveKycTier(existingVerification, payoutProfile) !==
        KycTierDto.BASIC
    ) {
      throw new BadRequestException(
        'Basic KYC must be approved before face verification can be submitted',
      );
    }

    if (!existingVerification.verificationMode) {
      throw new BadRequestException(
        'Identity verification must be started before liveness can be submitted',
      );
    }

    if (
      existingVerification.accountOwnershipType ===
        AccountOwnershipType.BUSINESS &&
      existingVerification.businessStatus !== KycVerificationStatus.VERIFIED
    ) {
      if (
        existingVerification.businessStatus ===
        KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Business verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        'Business verification must pass before face verification can start',
      );
    }

    if (
      existingVerification.identityStatus !== KycVerificationStatus.VERIFIED &&
      !(
        existingVerification.accountOwnershipType ===
          AccountOwnershipType.BUSINESS &&
        existingVerification.identityStatus === KycVerificationStatus.SUBMITTED
      )
    ) {
      if (
        existingVerification.identityStatus ===
        KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Identity verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        'Identity verification must pass before face verification can start',
      );
    }

    if (!dto.imageUrl && !dto.photoBase64) {
      throw new BadRequestException(
        'A selfie photo URL or base64 image is required for face verification',
      );
    }

    const faceVerificationResponse = await this.dikriptService.verifyLiveness({
      photoUrl: dto.imageUrl || null,
      photoBase64: dto.photoBase64 || null,
    });
    const livenessStatus = this.resolveDikriptFaceVerificationStatus(
      faceVerificationResponse,
    );
    const fullUpgradePassed =
      existingVerification.status === KycVerificationStatus.VERIFIED &&
      this.canAutoApproveKycTier({
        targetTier: KycTierDto.FULL,
        accountOwnershipType: existingVerification.accountOwnershipType,
        businessStatus: existingVerification.businessStatus,
        identityStatus: existingVerification.identityStatus,
        livenessStatus,
        nameMatchStatus: existingVerification.nameMatchStatus,
        dedupStatus: existingVerification.dedupStatus,
      });
    const fullReviewRequired =
      livenessStatus === KycVerificationStatus.VERIFIED && !fullUpgradePassed;
    const existingMetadata = await this.getKycMetadata(userId);
    const nextTier = fullUpgradePassed ? KycTierDto.FULL : KycTierDto.BASIC;
    const kycSubmittedAt = fullReviewRequired ? new Date() : null;

    const verification = await this.prisma.creatorKycVerification.update({
      where: { userId },
      data: {
        provider: KYC_PROVIDER_DIKRIPT,
        status: fullUpgradePassed
          ? KycVerificationStatus.VERIFIED
          : fullReviewRequired
            ? KycVerificationStatus.SUBMITTED
            : existingVerification.status,
        livenessStatus,
        qoreLivenessCheckId: String(faceVerificationResponse.id),
        submittedAt: fullReviewRequired
          ? kycSubmittedAt
          : existingVerification.submittedAt,
        reviewedAt: fullReviewRequired ? null : existingVerification.reviewedAt,
        rejectionReason:
          livenessStatus === KycVerificationStatus.REJECTED
            ? 'Dikript could not verify the submitted face details'
            : fullReviewRequired
              ? 'Full KYC needs manual review before the tier can be upgraded.'
              : existingVerification.rejectionReason,
        metadata: {
          ...existingMetadata,
          kycTier: nextTier,
          approvedTier: nextTier,
          targetTier: KycTierDto.FULL,
          liveness: {
            imageUrl: dto.imageUrl || null,
            submittedAt: new Date().toISOString(),
            requiredAtSubmit: tierSummary.livenessRequired,
            faceVerification: this.summarizeDikriptFaceVerificationResponse(
              faceVerificationResponse,
            ),
          },
        },
      },
    });

    const updatedPayoutProfile =
      await this.prisma.creatorSettlementProfile.update({
        where: { userId },
        data: {
          kycStatus: KycVerificationStatus.VERIFIED,
          status: CreatorSettlementProfileStatus.ACTIVE,
          rejectionReason: null,
          approvedAt: fullUpgradePassed
            ? payoutProfile.approvedAt || new Date()
            : payoutProfile.approvedAt,
          rejectedAt: null,
          metadata: {
            ...this.normalizeJsonObject(payoutProfile.metadata),
            kycTier: nextTier,
            approvedTier: nextTier,
          },
        },
      });

    await this.syncCreatorSettlementStatus(
      userId,
      CreatorSettlementProfileStatus.ACTIVE,
    );

    return this.formatKyc(
      verification,
      updatedPayoutProfile,
      await this.getKycTierSummary(userId, verification, updatedPayoutProfile),
    );
  }

  async startBusinessKyc(userId: string, dto: StartBusinessKycDto) {
    const [payoutProfile, existingVerification] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
    ]);

    if (!payoutProfile) {
      throw new NotFoundException('Payout profile not found');
    }

    await this.assertNoDuplicatePayoutAccount(
      userId,
      payoutProfile.bankCode,
      payoutProfile.accountNumber,
    );

    if (!this.hasVerifiedPayoutAccount(payoutProfile)) {
      throw new BadRequestException(
        'Add a verified payout account before starting business verification',
      );
    }

    this.assertBusinessReferenceIsLocallyValid(dto.regNumber);
    const businessInputHash = this.hashVerificationInput(
      'businessIdentity',
      'CAC',
      dto.regNumber,
    );
    const cachedBusiness = this.getCachedVerificationAttempt(
      existingVerification?.metadata,
      'businessIdentity',
      businessInputHash,
    );
    let businessResponse: DikriptCacResponse | null = null;
    let businessStatus =
      cachedBusiness && existingVerification
        ? existingVerification.businessStatus
        : KycVerificationStatus.NOT_STARTED;
    let verifiedBusinessName =
      cachedBusiness && existingVerification
        ? existingVerification.verifiedBusinessName
        : null;
    let businessReference =
      cachedBusiness && existingVerification ? null : dto.regNumber || null;

    if (!cachedBusiness) {
      businessResponse = await this.dikriptService.verifyCacBasic({
        regNumber: dto.regNumber,
      });
      businessStatus = this.resolveDikriptBusinessStatus(businessResponse);
      verifiedBusinessName =
        businessResponse.cac?.companyName || dto.businessName || null;
      businessReference =
        businessResponse.cac?.rcNumber || dto.regNumber || null;
    }

    const businessReferenceHash = cachedBusiness
      ? existingVerification?.businessReferenceHash || null
      : this.hashKycSubject(businessReference);
    const businessReferenceLast4 = cachedBusiness
      ? existingVerification?.businessReferenceLast4 || null
      : this.getLast4(businessReference);
    const duplicateReview = cachedBusiness
      ? {
          status:
            existingVerification?.dedupStatus ||
            KycVerificationStatus.NOT_STARTED,
          reason: null,
          metadata: this.normalizeJsonObject(
            this.normalizeJsonObject(existingVerification?.metadata)
              .dedupReview,
          ),
        }
      : await this.detectDuplicateKycSignals({
          userId,
          businessReferenceHash,
          providerSubjectHash:
            existingVerification?.providerSubjectHash || null,
        });
    const nameMatch =
      businessStatus === KycVerificationStatus.VERIFIED
        ? this.evaluateSettlementNameMatch({
            accountOwnershipType: AccountOwnershipType.BUSINESS,
            accountName: payoutProfile.accountName,
            verifiedFullName: null,
            verifiedBusinessName,
          })
        : {
            status: NameMatchStatus.NOT_CHECKED,
            score: 0,
            reason: 'Business verification has not passed yet',
          };
    const workflowStatus = this.deriveVerificationWorkflowStatus({
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      businessStatus,
      identityStatus:
        existingVerification?.identityStatus ||
        KycVerificationStatus.NOT_STARTED,
      livenessStatus:
        existingVerification?.livenessStatus ||
        KycVerificationStatus.NOT_STARTED,
    });
    const basicAutoApproved = this.canAutoApproveKycTier({
      targetTier: KycTierDto.BASIC,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      businessStatus,
      nameMatchStatus: nameMatch.status,
      dedupStatus: duplicateReview.status,
    });
    const manualReviewReason =
      businessStatus === KycVerificationStatus.VERIFIED && !basicAutoApproved
        ? this.getKycManualReviewReason({
            nameMatchStatus: nameMatch.status,
            nameMatchReason: nameMatch.reason,
            duplicateReason: duplicateReview.reason,
            mismatchReason:
              'Payout account name does not match verified business',
            reviewReason:
              'Payout account name needs manual review before Basic KYC can be approved.',
          })
        : null;
    const nextVerificationStatus =
      businessStatus === KycVerificationStatus.REJECTED
        ? KycVerificationStatus.REJECTED
        : businessStatus === KycVerificationStatus.PENDING_PROVIDER
          ? KycVerificationStatus.PENDING_PROVIDER
          : basicAutoApproved
            ? KycVerificationStatus.VERIFIED
            : manualReviewReason
              ? KycVerificationStatus.SUBMITTED
              : workflowStatus;
    const payoutState = basicAutoApproved
      ? {
          kycStatus: KycVerificationStatus.VERIFIED,
          profileStatus: CreatorSettlementProfileStatus.ACTIVE,
          rejectionReason: null,
        }
      : manualReviewReason
        ? {
            kycStatus: KycVerificationStatus.SUBMITTED,
            profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
            rejectionReason: manualReviewReason,
          }
        : this.derivePayoutStateFromVerificationStatus(
            workflowStatus,
            AccountOwnershipType.BUSINESS,
            existingVerification?.livenessStatus ||
              KycVerificationStatus.NOT_STARTED,
          );
    const approvedTier = basicAutoApproved ? KycTierDto.BASIC : KycTierDto.NONE;
    const kycSubmittedAt = manualReviewReason ? new Date() : null;

    const verification = await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        status: nextVerificationStatus,
        businessStatus,
        businessReferenceHash,
        businessReferenceLast4,
        dedupStatus: duplicateReview.status,
        nameMatchStatus: nameMatch.status,
        nameMatchScore: nameMatch.score,
        nameMatchReason: nameMatch.reason,
        verifiedBusinessName,
        submittedAt: kycSubmittedAt,
        reviewedAt: null,
        qoreBusinessCheckId: businessResponse
          ? String(businessResponse.id)
          : existingVerification?.qoreBusinessCheckId || null,
        rejectionReason:
          businessStatus === KycVerificationStatus.REJECTED
            ? 'Dikript could not verify the submitted business details'
            : manualReviewReason,
        metadata: {
          ...(await this.getKycMetadata(userId)),
          kycTier: approvedTier,
          approvedTier,
          targetTier: KycTierDto.BASIC,
          businessDraft: {
            regNumber: dto.regNumber,
            regNumberMasked: this.maskIdentityReference(dto.regNumber),
            businessName: dto.businessName || null,
          },
          dedupReview: duplicateReview.metadata,
          dikriptBusiness: businessResponse
            ? this.summarizeDikriptBusinessResponse(businessResponse)
            : this.normalizeJsonObject(existingVerification?.metadata)
                .dikriptBusiness || null,
          verificationCache: this.mergeVerificationCache(
            existingVerification?.metadata,
            'businessIdentity',
            {
              inputHash: businessInputHash,
              provider: 'DIKRIPT',
              requestId: businessResponse
                ? String(businessResponse.id)
                : existingVerification?.qoreBusinessCheckId || null,
              status: businessStatus,
              reused: Boolean(cachedBusiness),
              charged: !cachedBusiness,
              checkedAt: new Date().toISOString(),
            },
          ),
        },
      },
      create: {
        userId,
        settlementProfileId: payoutProfile.id,
        provider: KYC_PROVIDER_DIKRIPT,
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        status: nextVerificationStatus,
        businessStatus,
        businessReferenceHash,
        businessReferenceLast4,
        dedupStatus: duplicateReview.status,
        identityStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        nameMatchStatus: nameMatch.status,
        nameMatchScore: nameMatch.score,
        nameMatchReason: nameMatch.reason,
        verifiedBusinessName,
        submittedAt: kycSubmittedAt,
        reviewedAt: null,
        qoreBusinessCheckId: businessResponse
          ? String(businessResponse.id)
          : null,
        rejectionReason:
          businessStatus === KycVerificationStatus.REJECTED
            ? 'Dikript could not verify the submitted business details'
            : manualReviewReason,
        metadata: {
          kycTier: approvedTier,
          approvedTier,
          targetTier: KycTierDto.BASIC,
          businessDraft: {
            regNumber: dto.regNumber,
            regNumberMasked: this.maskIdentityReference(dto.regNumber),
            businessName: dto.businessName || null,
          },
          dedupReview: duplicateReview.metadata,
          dikriptBusiness: businessResponse
            ? this.summarizeDikriptBusinessResponse(businessResponse)
            : null,
          verificationCache: this.mergeVerificationCache(
            null,
            'businessIdentity',
            {
              inputHash: businessInputHash,
              provider: 'DIKRIPT',
              requestId: businessResponse ? String(businessResponse.id) : null,
              status: businessStatus,
              reused: Boolean(cachedBusiness),
              charged: !cachedBusiness,
              checkedAt: new Date().toISOString(),
            },
          ),
        },
      },
    });

    const updatedPayoutProfile =
      await this.prisma.creatorSettlementProfile.update({
        where: { userId },
        data: {
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          kycStatus: payoutState.kycStatus,
          status: payoutState.profileStatus,
          nameMatchStatus: nameMatch.status,
          approvedAt: basicAutoApproved
            ? payoutProfile.approvedAt || new Date()
            : null,
          rejectedAt: null,
          rejectionReason: payoutState.rejectionReason,
          metadata: {
            ...this.normalizeJsonObject(payoutProfile.metadata),
            kycTier: approvedTier,
            approvedTier,
          },
        },
      });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(
      verification,
      updatedPayoutProfile,
      await this.getKycTierSummary(userId, verification, updatedPayoutProfile),
    );
  }

  async startBusinessRepresentativeKyc(
    userId: string,
    dto: StartBusinessRepresentativeKycDto,
  ) {
    const [payoutProfile, verification, user] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          fullName: true,
          phoneNumber: true,
          email: true,
          gender: true,
        },
      }),
    ]);

    if (!payoutProfile || !verification) {
      throw new NotFoundException('Business KYC profile not found');
    }

    const verificationMetadata = this.normalizeJsonObject(
      verification.metadata,
    );

    await this.assertNoDuplicatePayoutAccount(
      userId,
      payoutProfile.bankCode,
      payoutProfile.accountNumber,
    );

    if (verification.businessStatus !== KycVerificationStatus.VERIFIED) {
      if (
        verification.businessStatus === KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Business verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        'Business verification must pass before representative identity can start',
      );
    }

    if (verification.nameMatchStatus === NameMatchStatus.MISMATCH) {
      throw new BadRequestException(
        'Business name must match the payout account before representative verification can start',
      );
    }

    if (verification.nameMatchStatus === NameMatchStatus.NOT_CHECKED) {
      throw new BadRequestException(
        'Business name match must be checked before representative verification can start',
      );
    }

    const storedBusinessRegNumber = this.resolveStoredBusinessRegNumber(
      verification.metadata,
    );

    if (!storedBusinessRegNumber) {
      throw new BadRequestException(
        'Business CAC registration must be refreshed before representative verification can start',
      );
    }

    const representativeNames = this.resolveIdentityNames(
      dto.representativeFirstName,
      dto.representativeLastName,
      payoutProfile.legalName ||
        user?.fullName ||
        payoutProfile.accountName ||
        null,
    );

    if (!representativeNames) {
      throw new BadRequestException(
        'Representative first and last name are required for business KYC',
      );
    }

    const verificationMode = this.resolveBusinessVerificationMode(dto);
    const identityReference = this.resolveIdentityReferenceFromMode(
      verificationMode,
      dto,
    );
    this.assertIdentityReferenceIsLocallyValid(
      verificationMode,
      identityReference,
    );
    const representativeInputHash = this.hashVerificationInput(
      'businessRepresentative',
      verificationMode,
      identityReference,
    );
    const cachedRepresentative = this.getCachedVerificationAttempt(
      verification.metadata,
      'businessRepresentative',
      representativeInputHash,
    );
    let representativeResponse: DikriptNinResponse | null = null;
    let identityStatus = cachedRepresentative
      ? verification.identityStatus
      : KycVerificationStatus.NOT_STARTED;
    let identityRecord: any = null;
    let verifiedRepresentativeName = cachedRepresentative
      ? verification.verifiedFullName
      : null;
    let verifiedRepresentativeDateOfBirth = cachedRepresentative
      ? verification.verifiedDateOfBirth
      : null;
    let providerSubject: string | null = null;

    if (!cachedRepresentative) {
      representativeResponse =
        await this.verifyBusinessRepresentativeWithDikript({
          verificationMode,
          dto,
          representativeNames,
          user,
        });

      if (!representativeResponse) {
        throw new BadRequestException(
          'Representative NIN, BVN, or phone number is required for business KYC',
        );
      }

      identityStatus = this.resolveDikriptIdentityStatus(
        representativeResponse,
      );
      identityRecord = this.extractIdentityRecord(representativeResponse);
      verifiedRepresentativeName = this.combineNameParts(
        identityRecord?.firstname,
        identityRecord?.middlename,
        identityRecord?.lastname,
      );
      verifiedRepresentativeDateOfBirth = this.parseDate(
        identityRecord?.birthdate || dto.representativeDateOfBirth || null,
      );
      providerSubject = this.extractProviderSubject(representativeResponse);
    }

    const identityType = this.resolveIdentityTypeFromMode(verificationMode);
    const providerSubjectHash = cachedRepresentative
      ? verification.providerSubjectHash || null
      : this.hashKycSubject(providerSubject);
    const providerSubjectLast4 = cachedRepresentative
      ? verification.providerSubjectLast4 || null
      : this.getLast4(providerSubject);
    const nameDobHash = this.hashNameDob(
      verifiedRepresentativeName,
      verifiedRepresentativeDateOfBirth,
    );
    const duplicateReview = cachedRepresentative
      ? {
          status: verification.dedupStatus || KycVerificationStatus.NOT_STARTED,
          reason: null,
          metadata: this.normalizeJsonObject(verificationMetadata.dedupReview),
        }
      : await this.detectDuplicateKycSignals({
          userId,
          providerSubjectHash,
          businessReferenceHash: verification.businessReferenceHash || null,
          nameDobHash,
        });
    const businessOwnershipInputHash = this.hashVerificationInput(
      'businessOwnership',
      'CAC_ADVANCED',
      `${storedBusinessRegNumber}|${verifiedRepresentativeName || ''}`,
    );
    const cachedBusinessOwnership = this.getCachedVerificationAttempt(
      verification.metadata,
      'businessOwnership',
      businessOwnershipInputHash,
    );
    let businessAdvancedResponse: DikriptCacResponse | null = null;
    let businessAdvancedStatus = cachedBusinessOwnership
      ? (cachedBusinessOwnership.businessStatus as KycVerificationStatus) ||
        KycVerificationStatus.NOT_STARTED
      : KycVerificationStatus.NOT_STARTED;
    let representativeOwnershipMatch = cachedBusinessOwnership
      ? {
          status:
            (cachedBusinessOwnership.matchStatus as NameMatchStatus) ||
            NameMatchStatus.NOT_CHECKED,
          score: Number(cachedBusinessOwnership.matchScore || 0),
          reason:
            typeof cachedBusinessOwnership.reason === 'string'
              ? cachedBusinessOwnership.reason
              : 'Reused previous CAC director match',
          matchedName:
            typeof cachedBusinessOwnership.matchedName === 'string'
              ? cachedBusinessOwnership.matchedName
              : null,
          matchedRole:
            typeof cachedBusinessOwnership.matchedRole === 'string'
              ? cachedBusinessOwnership.matchedRole
              : null,
        }
      : null;

    if (
      identityStatus === KycVerificationStatus.VERIFIED &&
      !cachedBusinessOwnership
    ) {
      businessAdvancedResponse = await this.dikriptService.verifyCacAdvanced({
        regNumber: storedBusinessRegNumber,
      });
      businessAdvancedStatus = this.resolveDikriptBusinessStatus(
        businessAdvancedResponse,
      );
      representativeOwnershipMatch =
        businessAdvancedStatus === KycVerificationStatus.VERIFIED
          ? this.evaluateBusinessRepresentativeDirectorMatch({
              representativeName: verifiedRepresentativeName,
              businessResponse: businessAdvancedResponse,
            })
          : {
              status: NameMatchStatus.MISMATCH,
              score: 0,
              reason:
                'CAC advanced director check could not verify the business',
              matchedName: null,
              matchedRole: null,
            };
    }

    if (identityStatus === KycVerificationStatus.VERIFIED) {
      if (businessAdvancedStatus !== KycVerificationStatus.VERIFIED) {
        identityStatus = KycVerificationStatus.REJECTED;
      } else if (
        representativeOwnershipMatch?.status === NameMatchStatus.MISMATCH
      ) {
        identityStatus = KycVerificationStatus.REJECTED;
      } else if (
        representativeOwnershipMatch?.status === NameMatchStatus.REVIEW_REQUIRED
      ) {
        identityStatus = KycVerificationStatus.SUBMITTED;
      }
    }

    const workflowStatus = this.deriveVerificationWorkflowStatus({
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      businessStatus: verification.businessStatus,
      identityStatus,
      livenessStatus: KycVerificationStatus.NOT_STARTED,
    });
    const payoutState = this.derivePayoutStateFromVerificationStatus(
      workflowStatus,
      AccountOwnershipType.BUSINESS,
      KycVerificationStatus.NOT_STARTED,
    );
    const existingTier = this.resolveKycTier(verification, payoutProfile);
    const shouldPreserveBasicTier =
      existingTier === KycTierDto.BASIC &&
      payoutProfile.status === CreatorSettlementProfileStatus.ACTIVE;
    const fullAutoApproved = this.canAutoApproveKycTier({
      targetTier: KycTierDto.FULL,
      accountOwnershipType: AccountOwnershipType.BUSINESS,
      businessStatus: verification.businessStatus,
      identityStatus,
      livenessStatus: KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: verification.nameMatchStatus,
      dedupStatus: duplicateReview.status,
    });
    const representativeManualReviewReason =
      identityStatus === KycVerificationStatus.SUBMITTED ||
      duplicateReview.status === KycVerificationStatus.SUBMITTED
        ? duplicateReview.reason ||
          representativeOwnershipMatch?.reason ||
          'Representative relationship needs manual review before Full KYC can be approved.'
        : null;
    const nextTier = fullAutoApproved
      ? KycTierDto.FULL
      : shouldPreserveBasicTier
        ? KycTierDto.BASIC
        : KycTierDto.NONE;
    const nextVerificationStatus =
      identityStatus === KycVerificationStatus.REJECTED &&
      !shouldPreserveBasicTier
        ? KycVerificationStatus.REJECTED
        : fullAutoApproved
          ? KycVerificationStatus.VERIFIED
          : representativeManualReviewReason
            ? KycVerificationStatus.SUBMITTED
            : shouldPreserveBasicTier
              ? KycVerificationStatus.VERIFIED
              : workflowStatus;
    const nextPayoutState =
      fullAutoApproved || shouldPreserveBasicTier
        ? {
            kycStatus: KycVerificationStatus.VERIFIED,
            profileStatus: CreatorSettlementProfileStatus.ACTIVE,
            rejectionReason: null,
          }
        : representativeManualReviewReason
          ? {
              kycStatus: KycVerificationStatus.SUBMITTED,
              profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
              rejectionReason: representativeManualReviewReason,
            }
          : payoutState;
    const kycSubmittedAt = representativeManualReviewReason
      ? new Date()
      : verification.submittedAt || null;

    const updatedVerification = await this.prisma.creatorKycVerification.update(
      {
        where: { userId },
        data: {
          provider: KYC_PROVIDER_DIKRIPT,
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          verificationMode,
          phoneNumber:
            dto.representativePhoneNumber || user?.phoneNumber || undefined,
          identityType,
          identityReferenceMasked:
            this.maskIdentityReference(identityReference),
          identityReferenceLast4: this.getLast4(identityReference),
          providerSubjectHash,
          providerSubjectLast4,
          status: nextVerificationStatus,
          identityStatus,
          livenessStatus: KycVerificationStatus.NOT_STARTED,
          qoreLivenessCheckId: null,
          dedupStatus: duplicateReview.status,
          nameMatchStatus: verification.nameMatchStatus,
          verifiedFullName: verifiedRepresentativeName,
          verifiedDateOfBirth: verifiedRepresentativeDateOfBirth,
          nameDobHash,
          submittedAt: kycSubmittedAt,
          reviewedAt: representativeManualReviewReason
            ? null
            : verification.reviewedAt,
          qoreIdentityCheckId: representativeResponse
            ? String(representativeResponse.id)
            : verification.qoreIdentityCheckId || null,
          rejectionReason:
            identityStatus === KycVerificationStatus.REJECTED
              ? representativeOwnershipMatch?.reason ||
                'Dikript could not verify the submitted representative details'
              : representativeManualReviewReason,
          metadata: {
            ...(await this.getKycMetadata(userId)),
            kycTier: nextTier,
            approvedTier: nextTier,
            targetTier: KycTierDto.FULL,
            businessDraft: {
              ...this.normalizeJsonObject(verificationMetadata.businessDraft),
              regNumber: storedBusinessRegNumber,
              regNumberMasked: this.maskIdentityReference(
                storedBusinessRegNumber,
              ),
              representativeFirstName: representativeNames.firstName,
              representativeLastName: representativeNames.lastName,
              representativeDateOfBirth: dto.representativeDateOfBirth || null,
              representativePhoneNumber: dto.representativePhoneNumber || null,
              representativeIdentityReference:
                this.maskIdentityReference(identityReference),
            },
            dedupReview: duplicateReview.metadata,
            businessRepresentativeMatch: representativeOwnershipMatch,
            dikriptRepresentative: representativeResponse
              ? this.summarizeDikriptIdentityResponse(representativeResponse, {
                  verificationMode,
                  identityType,
                })
              : verificationMetadata.dikriptRepresentative || null,
            dikriptBusinessAdvanced: businessAdvancedResponse
              ? this.summarizeDikriptBusinessResponse(businessAdvancedResponse)
              : verificationMetadata.dikriptBusinessAdvanced || null,
            verificationCache: {
              ...this.normalizeJsonObject(
                verificationMetadata.verificationCache,
              ),
              businessRepresentative: {
                inputHash: representativeInputHash,
                provider: 'DIKRIPT',
                requestId: representativeResponse
                  ? String(representativeResponse.id)
                  : verification.qoreIdentityCheckId || null,
                status: identityStatus,
                reused: Boolean(cachedRepresentative),
                charged: !cachedRepresentative,
                checkedAt: new Date().toISOString(),
              },
              ...(representativeOwnershipMatch || cachedBusinessOwnership
                ? {
                    businessOwnership: {
                      inputHash: businessOwnershipInputHash,
                      provider: 'DIKRIPT',
                      requestId: businessAdvancedResponse
                        ? String(businessAdvancedResponse.id)
                        : cachedBusinessOwnership?.requestId || null,
                      businessStatus: businessAdvancedStatus,
                      matchStatus:
                        representativeOwnershipMatch?.status ||
                        NameMatchStatus.NOT_CHECKED,
                      matchScore: representativeOwnershipMatch?.score || 0,
                      matchedName:
                        representativeOwnershipMatch?.matchedName || null,
                      matchedRole:
                        representativeOwnershipMatch?.matchedRole || null,
                      reason: representativeOwnershipMatch?.reason || null,
                      reused: Boolean(cachedBusinessOwnership),
                      charged: Boolean(businessAdvancedResponse),
                      checkedAt: new Date().toISOString(),
                    },
                  }
                : {}),
            },
          },
        },
      },
    );

    const updatedPayoutProfile =
      await this.prisma.creatorSettlementProfile.update({
        where: { userId },
        data: {
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          kycStatus: nextPayoutState.kycStatus,
          status: nextPayoutState.profileStatus,
          approvedAt:
            fullAutoApproved || shouldPreserveBasicTier
              ? payoutProfile.approvedAt || new Date()
              : null,
          rejectedAt: null,
          rejectionReason: nextPayoutState.rejectionReason,
          metadata: {
            ...this.normalizeJsonObject(payoutProfile.metadata),
            kycTier: nextTier,
            approvedTier: nextTier,
          },
        },
      });

    await this.syncCreatorSettlementStatus(
      userId,
      nextPayoutState.profileStatus,
    );

    return this.formatKyc(
      updatedVerification,
      updatedPayoutProfile,
      await this.getKycTierSummary(
        userId,
        updatedVerification,
        updatedPayoutProfile,
      ),
    );
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    if (!dto.confirm) {
      throw new BadRequestException('KYC submission must be confirmed');
    }

    const [verification, payoutProfile] = await Promise.all([
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
    ]);

    if (!verification || !payoutProfile) {
      throw new NotFoundException('KYC profile not found');
    }

    const targetTier =
      dto.targetTier === KycTierDto.FULL ? KycTierDto.FULL : KycTierDto.BASIC;
    const requiresIdentityForTargetTier =
      verification.accountOwnershipType !== AccountOwnershipType.BUSINESS ||
      targetTier === KycTierDto.FULL;

    if (
      verification.accountOwnershipType === AccountOwnershipType.BUSINESS &&
      verification.businessStatus !== KycVerificationStatus.VERIFIED
    ) {
      if (
        verification.businessStatus === KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Business verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        'Business verification must pass before KYC can be submitted',
      );
    }

    if (
      requiresIdentityForTargetTier &&
      verification.identityStatus !== KycVerificationStatus.VERIFIED &&
      !(
        verification.accountOwnershipType === AccountOwnershipType.BUSINESS &&
        targetTier === KycTierDto.FULL &&
        verification.identityStatus === KycVerificationStatus.SUBMITTED
      )
    ) {
      if (
        verification.identityStatus === KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          verification.accountOwnershipType === AccountOwnershipType.BUSINESS
            ? 'Representative verification is still pending provider response'
            : 'Identity verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        verification.accountOwnershipType === AccountOwnershipType.BUSINESS
          ? 'Representative verification must pass before Full KYC can be submitted'
          : 'Identity verification must pass before KYC can be submitted',
      );
    }

    if (targetTier === KycTierDto.FULL) {
      if (
        verification.livenessStatus === KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Face verification is still pending provider response',
        );
      }

      if (verification.livenessStatus !== KycVerificationStatus.VERIFIED) {
        throw new BadRequestException(
          'Face verification must pass before Full KYC can be submitted',
        );
      }
    }

    const nameMatch = this.evaluateSettlementNameMatch({
      accountOwnershipType: payoutProfile.accountOwnershipType,
      accountName: payoutProfile.accountName,
      verifiedFullName: verification.verifiedFullName,
      verifiedBusinessName: verification.verifiedBusinessName,
    });

    if (nameMatch.status === NameMatchStatus.MISMATCH) {
      throw new BadRequestException(
        'Payout account name does not match the verified KYC details. Update the payout account or verification details before submitting.',
      );
    }

    const requiresDuplicateReview =
      verification.dedupStatus === KycVerificationStatus.SUBMITTED;
    const duplicateReviewReason = requiresDuplicateReview
      ? 'This verification requires manual review before payouts can be activated.'
      : null;
    const nextPayoutProfileStatus =
      requiresDuplicateReview ||
      nameMatch.status === NameMatchStatus.REVIEW_REQUIRED
        ? CreatorSettlementProfileStatus.REVIEW_REQUIRED
        : CreatorSettlementProfileStatus.PENDING_KYC;
    const existingMetadata = await this.getKycMetadata(userId);

    const updatedVerification = await this.prisma.creatorKycVerification.update(
      {
        where: { userId },
        data: {
          provider: KYC_PROVIDER_DIKRIPT,
          status: KycVerificationStatus.SUBMITTED,
          submittedAt: new Date(),
          nameMatchStatus: nameMatch.status,
          nameMatchScore: nameMatch.score,
          nameMatchReason: nameMatch.reason,
          rejectionReason: duplicateReviewReason,
          metadata: {
            ...existingMetadata,
            targetTier,
            flow: {
              ...this.normalizeJsonObject(existingMetadata.flow),
              submittedTargetTier: targetTier,
              submittedAt: new Date().toISOString(),
            },
          },
        },
      },
    );

    await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        status: nextPayoutProfileStatus,
        kycStatus: KycVerificationStatus.SUBMITTED,
        nameMatchStatus: nameMatch.status,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: duplicateReviewReason,
      },
    });

    await this.syncCreatorSettlementStatus(userId, nextPayoutProfileStatus);

    return this.formatKyc(
      updatedVerification,
      payoutProfile,
      await this.getKycTierSummary(userId, updatedVerification, payoutProfile),
    );
  }

  async notifyOnKycResolution(userId: string, dto: NotifyOnKycResolutionDto) {
    const verification = await this.prisma.creatorKycVerification.findUnique({
      where: { userId },
    });

    if (!verification) {
      throw new NotFoundException('KYC profile not found');
    }

    const target = dto.target as KycResolutionNotificationTargetDto;
    const targetState = this.getKycResolutionTargetState(verification, target);

    if (!targetState.requestId) {
      throw new BadRequestException(
        'No provider request was found for the selected verification step',
      );
    }

    if (targetState.status === KycVerificationStatus.PENDING_PROVIDER) {
      const metadata = await this.getKycMetadata(userId);
      const nextMetadata = {
        ...metadata,
        resolutionNotification: {
          target,
          requestId: targetState.requestId,
          requestedAt: new Date().toISOString(),
          sentAt: null,
          resolvedStatus: null,
        },
      };

      await this.prisma.creatorKycVerification.update({
        where: { userId },
        data: {
          metadata: nextMetadata,
        },
      });

      return {
        status: 'success',
        message: 'We will notify you once this verification step resolves.',
        data: {
          queued: true,
          sent: false,
          target,
          currentStatus: targetState.status,
        },
      };
    }

    if (
      targetState.status === KycVerificationStatus.VERIFIED ||
      targetState.status === KycVerificationStatus.REJECTED
    ) {
      const sent = await this.sendQueuedKycResolutionNotification(
        verification,
        target,
        targetState.requestId,
        targetState.status,
        { force: true },
      );

      return {
        status: 'success',
        message: sent
          ? 'Verification already resolved. A notification has been sent.'
          : 'Verification already resolved.',
        data: {
          queued: false,
          sent,
          target,
          currentStatus: targetState.status,
        },
      };
    }

    throw new BadRequestException(
      'This verification step is not waiting on provider response',
    );
  }

  async reviewKyc(userId: string, dto: ReviewKycDto, actor: DashboardActor) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);

    const [payoutProfile, existingVerification] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      }),
    ]);

    if (!payoutProfile || !existingVerification) {
      throw new NotFoundException('KYC profile not found');
    }

    const nextKycStatus = dto.status as KycVerificationStatus;
    const nextNameMatchStatus = dto.nameMatchStatus as NameMatchStatus;
    const existingVerificationMetadata = this.normalizeJsonObject(
      existingVerification.metadata,
    );
    const existingPayoutMetadata = this.normalizeJsonObject(
      payoutProfile.metadata,
    );
    const requestedApprovedTier =
      dto.approvedTier === KycTierDto.FULL ||
      existingVerificationMetadata.targetTier === KycTierDto.FULL
        ? KycTierDto.FULL
        : KycTierDto.BASIC;

    if (
      nextKycStatus === KycVerificationStatus.VERIFIED &&
      requestedApprovedTier === KycTierDto.FULL &&
      existingVerification.accountOwnershipType ===
        AccountOwnershipType.BUSINESS &&
      existingVerification.identityStatus !== KycVerificationStatus.VERIFIED &&
      existingVerification.identityStatus !== KycVerificationStatus.SUBMITTED
    ) {
      throw new BadRequestException(
        'Full business KYC approval requires verified representative identity',
      );
    }

    if (
      nextKycStatus === KycVerificationStatus.VERIFIED &&
      requestedApprovedTier === KycTierDto.FULL &&
      existingVerification.livenessStatus !== KycVerificationStatus.VERIFIED
    ) {
      throw new BadRequestException(
        'Full KYC approval requires a verified liveness check',
      );
    }

    const approvedTier =
      nextKycStatus === KycVerificationStatus.VERIFIED
        ? requestedApprovedTier
        : KycTierDto.NONE;
    const nextPayoutStatus =
      nextKycStatus === KycVerificationStatus.VERIFIED &&
      nextNameMatchStatus === NameMatchStatus.MATCHED
        ? CreatorSettlementProfileStatus.ACTIVE
        : nextKycStatus === KycVerificationStatus.REJECTED ||
            nextNameMatchStatus === NameMatchStatus.MISMATCH
          ? CreatorSettlementProfileStatus.REJECTED
          : CreatorSettlementProfileStatus.REVIEW_REQUIRED;

    const [verification] = await this.prisma.$transaction([
      this.prisma.creatorKycVerification.update({
        where: { userId },
        data: {
          status: nextKycStatus,
          businessStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED &&
            existingVerification.accountOwnershipType ===
              AccountOwnershipType.BUSINESS
              ? KycVerificationStatus.VERIFIED
              : existingVerification.businessStatus,
          identityStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED &&
            (existingVerification.accountOwnershipType !==
              AccountOwnershipType.BUSINESS ||
              approvedTier === KycTierDto.FULL)
              ? KycVerificationStatus.VERIFIED
              : existingVerification.identityStatus,
          livenessStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED &&
            approvedTier === KycTierDto.FULL
              ? KycVerificationStatus.VERIFIED
              : existingVerification.livenessStatus,
          amlStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED
              ? KycVerificationStatus.VERIFIED
              : existingVerification.amlStatus,
          dedupStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED
              ? KycVerificationStatus.VERIFIED
              : nextKycStatus === KycVerificationStatus.REJECTED
                ? KycVerificationStatus.REJECTED
                : existingVerification.dedupStatus,
          nameMatchStatus: nextNameMatchStatus,
          nameMatchReason: dto.note || null,
          reviewedAt: new Date(),
          rejectionReason: dto.rejectionReason || null,
          metadata: {
            ...existingVerificationMetadata,
            kycTier: approvedTier,
            approvedTier,
            targetTier:
              approvedTier === KycTierDto.NONE
                ? existingVerificationMetadata.targetTier || KycTierDto.BASIC
                : approvedTier,
            review: {
              reviewedAt: new Date().toISOString(),
              status: nextKycStatus,
              nameMatchStatus: nextNameMatchStatus,
              note: dto.note || null,
              approvedTier,
            },
          },
        },
      }),
      this.prisma.creatorSettlementProfile.update({
        where: { userId },
        data: {
          status: nextPayoutStatus,
          kycStatus: nextKycStatus,
          nameMatchStatus: nextNameMatchStatus,
          approvedAt:
            nextPayoutStatus === CreatorSettlementProfileStatus.ACTIVE
              ? new Date()
              : null,
          rejectedAt:
            nextPayoutStatus === CreatorSettlementProfileStatus.REJECTED
              ? new Date()
              : null,
          rejectionReason: dto.rejectionReason || null,
          metadata: {
            ...existingPayoutMetadata,
            kycTier: approvedTier,
            approvedTier,
          },
        },
      }),
    ]);

    await this.syncCreatorSettlementStatus(userId, nextPayoutStatus);

    return this.formatKyc(
      verification,
      payoutProfile,
      await this.getKycTierSummary(userId, verification, payoutProfile),
    );
  }

  async upsertAlatProfile(
    userId: string,
    dto: UpsertAlatProfileDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);

    const payoutProfile = await this.prisma.creatorSettlementProfile.findUnique(
      {
        where: { userId },
        select: {
          accountNumber: true,
          accountName: true,
          status: true,
          metadata: true,
          kycVerification: {
            select: {
              metadata: true,
              status: true,
              livenessStatus: true,
            },
          },
        },
      },
    );

    const status = dto.status as CreatorAlatProfileStatus;
    const resolvedAccountNumber =
      dto.accountNumber || payoutProfile?.accountNumber;
    const resolvedAccountName = dto.accountName || payoutProfile?.accountName;
    const resolvedDisplayName =
      dto.displayName ||
      (resolvedAccountName
        ? this.buildAlatDisplayName(resolvedAccountName)
        : null);

    if (
      status === CreatorAlatProfileStatus.ACTIVE &&
      (!resolvedAccountNumber || !resolvedDisplayName || !dto.businessId)
    ) {
      throw new BadRequestException(
        'Active ALAT profile requires account number, display name, and business ID',
      );
    }

    if (
      status === CreatorAlatProfileStatus.ACTIVE &&
      payoutProfile?.status !== CreatorSettlementProfileStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'Creator payout profile must be active before ALAT transfer can be enabled',
      );
    }

    if (
      status === CreatorAlatProfileStatus.ACTIVE &&
      this.resolveKycTier(payoutProfile?.kycVerification, payoutProfile) !==
        KycTierDto.FULL
    ) {
      throw new BadRequestException(
        'Creator must complete Full KYC before ALAT transfer can be enabled',
      );
    }

    const existingProfile = await this.prisma.creatorAlatProfile.findUnique({
      where: { userId },
    });

    const profile = await this.prisma.creatorAlatProfile.upsert({
      where: { userId },
      update: {
        status,
        displayName: resolvedDisplayName,
        businessId: dto.businessId || existingProfile?.businessId || null,
        subaccountReference:
          dto.subaccountReference || existingProfile?.subaccountReference,
        accountNumber: resolvedAccountNumber,
        accountName: resolvedAccountName,
        notes: dto.notes || existingProfile?.notes || null,
        reviewedAt: new Date(),
        activatedAt:
          status === CreatorAlatProfileStatus.ACTIVE
            ? existingProfile?.activatedAt || new Date()
            : null,
        deactivatedAt:
          status === CreatorAlatProfileStatus.ACTIVE ? null : new Date(),
      },
      create: {
        userId,
        status,
        displayName: resolvedDisplayName,
        businessId: dto.businessId || null,
        subaccountReference: dto.subaccountReference,
        accountNumber: resolvedAccountNumber,
        accountName: resolvedAccountName,
        notes: dto.notes || null,
        reviewedAt: new Date(),
        activatedAt:
          status === CreatorAlatProfileStatus.ACTIVE ? new Date() : null,
        deactivatedAt:
          status === CreatorAlatProfileStatus.ACTIVE ? null : new Date(),
      },
    });

    return this.formatAlatProfile(profile);
  }

  async getTransactionHistory(userId: string, dto: WalletTransactionsQueryDto) {
    await this.backfillCreatorTransactions(userId);
    const payoutProfile = await this.prisma.creatorSettlementProfile.findUnique(
      {
        where: { userId },
        select: { status: true },
      },
    );

    if (payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE) {
      await this.syncCreatorSettlementStatus(userId, payoutProfile.status);
    }

    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;

    const whereClause: Prisma.TransactionReferenceWhereInput = {
      creatorId: userId,
      status: TransactionStatusType.SUCCESS,
      ...(dto.paymentType && { paymentType: dto.paymentType as PaymentType }),
      ...(dto.paymentProvider && {
        paymentProvider: dto.paymentProvider as any,
      }),
      ...(dto.settlementStatus && {
        settlementStatus: dto.settlementStatus as SettlementStatus,
      }),
      ...(dto.riskStatus && { riskStatus: dto.riskStatus as RiskStatus }),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transactionReference.findMany({
        where: whereClause,
        include: walletTransactionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.transactionReference.count({ where: whereClause }),
    ]);

    return {
      data: transactions.map((transaction) =>
        this.formatTransaction(transaction),
      ),
      page,
      pageSize,
      total,
    };
  }

  async getSettlementHistory(userId: string, dto: WalletSettlementsQueryDto) {
    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;

    const whereClause: Prisma.SettlementRecordWhereInput = {
      creatorId: userId,
      ...(dto.status && { status: dto.status as SettlementRecordStatus }),
    };

    const [settlements, total] = await Promise.all([
      this.prisma.settlementRecord.findMany({
        where: whereClause,
        include: {
          allocations: {
            select: { id: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.settlementRecord.count({ where: whereClause }),
    ]);

    return {
      data: settlements.map((settlement) => this.formatSettlement(settlement)),
      page,
      pageSize,
      total,
    };
  }

  async getInternalSettlementQueue(
    dto: InternalSettlementQueueQueryDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor);
    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const search = dto.search?.trim();
    const where: Prisma.UserWhereInput = {
      AND: [
        {
          OR: [
            {
              creatorTransactions: {
                some: { status: TransactionStatusType.SUCCESS },
              },
            },
            {
              eventsCreated: {
                some: {
                  transactions: {
                    some: {
                      status: TransactionStatusType.SUCCESS,
                      creatorId: null,
                    },
                  },
                },
              },
            },
          ],
        },
        ...(search
          ? [
              {
                OR: [
                  { id: search },
                  {
                    fullName: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    username: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                  {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const [creators, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { id: true, fullName: true, username: true, email: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const data = await Promise.all(
      creators.map(
        async (creator) =>
          (await this.calculateSettlementPreview(creator)).candidate,
      ),
    );
    return { data, total, page, pageSize };
  }

  async getInternalSettlements(
    dto: InternalSettlementsQueryDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor);
    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const where: Prisma.SettlementRecordWhereInput = {
      ...(dto.creatorId ? { creatorId: dto.creatorId } : {}),
      ...(dto.status ? { status: dto.status as SettlementRecordStatus } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.settlementRecord.findMany({
        where,
        include: {
          allocations: { select: { id: true } },
          creator: {
            select: { id: true, fullName: true, username: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.settlementRecord.count({ where }),
    ]);
    return {
      data: records.map((record) => ({
        ...this.formatSettlement(record),
        creator: record.creator,
      })),
      total,
      page,
      pageSize,
    };
  }

  async previewSettlement(creatorId: string, actor: DashboardActor) {
    assertDashboardAccess(actor);
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId },
      select: { id: true, fullName: true, username: true, email: true },
    });
    if (!creator) throw new NotFoundException('Creator not found');
    return this.calculateSettlementPreview(creator);
  }

  private loadReadySettlementTransactions(
    creatorId: string,
    transactionIds?: string[],
    db: Prisma.TransactionClient = this.prisma,
  ) {
    return db.transactionReference.findMany({
      where: {
        creatorId,
        status: TransactionStatusType.SUCCESS,
        settlementStatus: SettlementStatus.READY,
        riskStatus: RiskStatus.CLEAR,
        creatorPayable: { gt: 0 },
        settlementAllocations: { none: {} },
        ...(transactionIds?.length ? { id: { in: transactionIds } } : {}),
      },
      include: { event: { select: { id: true, title: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async calculateSettlementPreview(
    creator: Prisma.UserGetPayload<{
      select: { id: true; fullName: true; username: true; email: true };
    }>,
  ) {
    const wallet = await this.getWalletOverview(creator.id);
    const transactions = await this.loadReadySettlementTransactions(creator.id);
    const grossAmountKobo = transactions.reduce(
      (sum, transaction) => sum + resolveGrossAmountKobo(transaction),
      0,
    );
    const netAmountKobo = transactions.reduce(
      (sum, transaction) => sum + resolveCreatorPayableKobo(transaction),
      0,
    );
    const profile = wallet.payoutProfile;
    const blockers: string[] = [];
    if (!profile || profile.status !== CreatorSettlementProfileStatus.ACTIVE)
      blockers.push('An active payout profile is required.');
    if (
      !profile ||
      !profile.bankName ||
      !profile.accountName ||
      !profile.accountNumberMasked
    )
      blockers.push('The payout bank destination is incomplete.');
    if (!transactions.length)
      blockers.push('No unallocated payments are ready for settlement.');
    return {
      candidate: {
        creator,
        payoutProfile: profile
          ? {
              status: profile.status,
              kycTier: profile.kycTier,
              bankName: profile.bankName,
              accountName: profile.accountName,
              accountNumberMasked: profile.accountNumberMasked,
            }
          : null,
        balance: { ...wallet.balance, availableBalance: netAmountKobo / 100 },
        readyTransactionCount: transactions.length,
        canSettle: blockers.length === 0,
        blockers,
      },
      calculation: {
        grossAmountKobo,
        deductionsKobo: grossAmountKobo - netAmountKobo,
        netAmountKobo,
        transactionCount: transactions.length,
      },
      transactions: transactions.slice(0, 20).map((transaction) => ({
        id: transaction.id,
        grossAmount: resolveGrossAmountKobo(transaction) / 100,
        creatorPayable: resolveCreatorPayableKobo(transaction) / 100,
        createdAt: transaction.createdAt,
        event: transaction.event,
      })),
      evaluatedAt: new Date().toISOString(),
    };
  }

  async createSettlement(
    creatorId: string,
    dto: CreateSettlementDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    await this.backfillCreatorTransactions(creatorId);

    const payoutProfile = await this.prisma.creatorSettlementProfile.findUnique(
      {
        where: { userId: creatorId },
      },
    );

    if (!payoutProfile) {
      throw new NotFoundException('Creator payout profile not found');
    }

    if (payoutProfile.status !== CreatorSettlementProfileStatus.ACTIVE) {
      throw new BadRequestException('Creator payout profile is not active');
    }

    await this.syncCreatorSettlementStatus(creatorId, payoutProfile.status);

    if (
      !payoutProfile.bankName ||
      !payoutProfile.accountName ||
      !payoutProfile.accountNumber
    ) {
      throw new BadRequestException('Creator payout destination is incomplete');
    }

    if (
      (dto.expectedAmountKobo === undefined) !==
      (dto.expectedTransactionCount === undefined)
    ) {
      throw new BadRequestException(
        'Provide both the preview amount and payment count.',
      );
    }

    const settlement = await this.prisma.$transaction(async (tx) => {
      const transactions = await this.loadReadySettlementTransactions(
        creatorId,
        dto.transactionIds,
        tx,
      );
      if (!transactions.length)
        throw new BadRequestException(
          'No transactions are ready for settlement',
        );
      const totalAmount = transactions.reduce(
        (sum, transaction) => sum + resolveCreatorPayableKobo(transaction),
        0,
      );
      if (
        (dto.transactionIds?.length &&
          transactions.length !== new Set(dto.transactionIds).size) ||
        (dto.expectedAmountKobo !== undefined &&
          (dto.expectedAmountKobo !== totalAmount ||
            dto.expectedTransactionCount !== transactions.length))
      )
        throw new ConflictException(
          'Settlement eligibility changed. Recalculate the preview before creating a settlement.',
        );

      const claimed = await tx.transactionReference.updateMany({
        where: {
          id: { in: transactions.map((transaction) => transaction.id) },
          creatorId,
          status: TransactionStatusType.SUCCESS,
          settlementStatus: SettlementStatus.READY,
          riskStatus: RiskStatus.CLEAR,
          creatorPayable: { gt: 0 },
          settlementAllocations: { none: {} },
        },
        data: { settlementStatus: SettlementStatus.PROCESSING },
      });
      if (claimed.count !== transactions.length)
        throw new ConflictException(
          'A payment changed during settlement preparation. Recalculate the preview.',
        );

      const settlementRecord = await tx.settlementRecord.create({
        data: {
          creatorId,
          amount: totalAmount,
          reference: this.generateSettlementReference(),
          status: SettlementRecordStatus.PENDING,
          destinationBankName: payoutProfile.bankName,
          destinationAccountName: payoutProfile.accountName,
          destinationAccountNumber: payoutProfile.accountNumber,
        },
      });
      await tx.settlementAllocation.createMany({
        data: transactions.map((transaction) => ({
          settlementId: settlementRecord.id,
          transactionReferenceId: transaction.id,
          amount: resolveCreatorPayableKobo(transaction),
        })),
      });
      return settlementRecord;
    });

    const completeSettlement = await this.prisma.settlementRecord.findUnique({
      where: { id: settlement.id },
      include: {
        allocations: {
          select: { id: true },
        },
      },
    });

    return this.formatSettlement(completeSettlement);
  }

  async completeSettlement(
    settlementId: string,
    dto: CompleteSettlementDto,
    actor: DashboardActor,
  ) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);

    const settlement = await this.prisma.settlementRecord.findUnique({
      where: { id: settlementId },
      include: {
        allocations: {
          select: { transactionReferenceId: true },
        },
      },
    });

    if (!settlement) {
      throw new NotFoundException('Settlement not found');
    }

    const allocationIds = settlement.allocations.map(
      (allocation) => allocation.transactionReferenceId,
    );

    const status = dto.status as SettlementRecordStatus;
    if (
      settlement.status === SettlementRecordStatus.SUCCESS &&
      status !== SettlementRecordStatus.SUCCESS
    ) {
      throw new BadRequestException(
        'A successful settlement cannot be reversed through outcome recording.',
      );
    }
    if (settlement.status === SettlementRecordStatus.SUCCESS) {
      return this.formatSettlement(settlement);
    }

    const updatedSettlement = await this.prisma
      .$transaction(async (tx) => {
        const record = await tx.settlementRecord.update({
          where: { id: settlementId, status: settlement.status },
          data: {
            status,
            processedAt:
              status === SettlementRecordStatus.PENDING ? null : new Date(),
            metadata: {
              ...(typeof settlement.metadata === 'object' && settlement.metadata
                ? settlement.metadata
                : {}),
              note: dto.note || null,
            },
          },
        });

        if (status === SettlementRecordStatus.SUCCESS) {
          await tx.transactionReference.updateMany({
            where: { id: { in: allocationIds } },
            data: {
              settlementStatus: SettlementStatus.SETTLED,
              settledAt: new Date(),
            },
          });
        } else if (
          status === SettlementRecordStatus.FAILED ||
          status === SettlementRecordStatus.CANCELLED
        ) {
          await tx.transactionReference.updateMany({
            where: { id: { in: allocationIds } },
            data: {
              settlementStatus: SettlementStatus.READY,
              settledAt: null,
            },
          });
        } else {
          await tx.transactionReference.updateMany({
            where: { id: { in: allocationIds } },
            data: {
              settlementStatus: SettlementStatus.PROCESSING,
              settledAt: null,
            },
          });
        }

        return record;
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        )
          throw new ConflictException(
            'Settlement changed during reconciliation. Refresh before trying again.',
          );
        throw error;
      });

    const hydratedSettlement = await this.prisma.settlementRecord.findUnique({
      where: { id: updatedSettlement.id },
      include: {
        allocations: {
          select: { id: true },
        },
      },
    });

    return this.formatSettlement(hydratedSettlement);
  }

  private async syncCreatorSettlementStatus(
    creatorId: string,
    profileStatus: CreatorSettlementProfileStatus,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    await this.backfillCreatorTransactions(creatorId, db);
    await this.resetUnsuccessfulSettlementStatuses({ creatorId }, db);

    if (profileStatus === CreatorSettlementProfileStatus.ACTIVE) {
      const payoutProfile = await db.creatorSettlementProfile.findUnique({
        where: { userId: creatorId },
        include: { kycVerification: true },
      });
      const kycTier = this.resolveKycTier(
        payoutProfile?.kycVerification,
        payoutProfile,
      );

      await db.transactionReference.updateMany({
        where: {
          creatorId,
          status: TransactionStatusType.SUCCESS,
          settlementStatus: {
            in: [
              SettlementStatus.HELD_KYC,
              SettlementStatus.READY,
              SettlementStatus.NOT_READY,
            ],
          },
          riskStatus: { not: RiskStatus.CLEAR },
        },
        data: {
          settlementStatus: SettlementStatus.HELD_RISK,
        },
      });

      if (kycTier === KycTierDto.FULL) {
        await db.transactionReference.updateMany({
          where: {
            creatorId,
            status: TransactionStatusType.SUCCESS,
            settlementStatus: {
              in: [
                SettlementStatus.HELD_KYC,
                SettlementStatus.HELD_RISK,
                SettlementStatus.NOT_READY,
              ],
            },
            riskStatus: RiskStatus.CLEAR,
          },
          data: {
            settlementStatus: SettlementStatus.READY,
          },
        });

        return;
      }

      if (kycTier === KycTierDto.BASIC) {
        await this.applyBasicKycSettlementCap(creatorId, db);
        return;
      }
    }

    await db.transactionReference.updateMany({
      where: {
        creatorId,
        status: TransactionStatusType.SUCCESS,
        settlementStatus: {
          in: [SettlementStatus.READY, SettlementStatus.HELD_RISK],
        },
      },
      data: {
        settlementStatus: SettlementStatus.HELD_KYC,
      },
    });
  }

  private async applyBasicKycSettlementCap(
    creatorId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const committedAggregate = await db.transactionReference.aggregate({
      _sum: { creatorPayable: true },
      where: {
        creatorId,
        status: TransactionStatusType.SUCCESS,
        settlementStatus: {
          in: [SettlementStatus.PROCESSING, SettlementStatus.SETTLED],
        },
      },
    });
    let committedKobo = committedAggregate._sum.creatorPayable || 0;

    const clearTransactions = await db.transactionReference.findMany({
      where: {
        creatorId,
        status: TransactionStatusType.SUCCESS,
        riskStatus: RiskStatus.CLEAR,
        settlementStatus: {
          in: [
            SettlementStatus.HELD_KYC,
            SettlementStatus.HELD_RISK,
            SettlementStatus.NOT_READY,
            SettlementStatus.READY,
          ],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const transaction of clearTransactions) {
      const creatorPayableKobo = resolveCreatorPayableKobo(transaction);
      const shouldRelease =
        committedKobo + creatorPayableKobo <= BASIC_KYC_SETTLEMENT_CAP_KOBO;
      const nextStatus = shouldRelease
        ? SettlementStatus.READY
        : SettlementStatus.HELD_KYC;

      if (shouldRelease) {
        committedKobo += creatorPayableKobo;
      }

      if (transaction.settlementStatus === nextStatus) {
        continue;
      }

      const metadata = this.normalizeJsonObject(transaction.metadata);
      await db.transactionReference.update({
        where: { id: transaction.id },
        data: {
          settlementStatus: nextStatus,
          metadata: {
            ...metadata,
            tierHold:
              nextStatus === SettlementStatus.HELD_KYC
                ? {
                    reason: 'BASIC_TIER_CAP_REACHED',
                    capKobo: BASIC_KYC_SETTLEMENT_CAP_KOBO,
                    evaluatedAt: new Date().toISOString(),
                  }
                : null,
          },
        },
      });
    }
  }

  private async backfillCreatorTransactions(
    creatorId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const payoutProfile = await db.creatorSettlementProfile.findUnique({
      where: { userId: creatorId },
      include: { kycVerification: true },
    });

    const transactions = await db.transactionReference.findMany({
      where: {
        OR: [
          { creatorId },
          {
            creatorId: null,
            event: {
              creatorId,
            },
          },
        ],
      },
      include: {
        event: {
          select: { creatorId: true },
        },
      },
    });

    for (const transaction of transactions) {
      const updates: Prisma.TransactionReferenceUpdateInput = {};
      const metadata =
        transaction.metadata &&
        typeof transaction.metadata === 'object' &&
        !Array.isArray(transaction.metadata)
          ? { ...(transaction.metadata as Record<string, any>) }
          : {};
      const platformFeeKobo = resolvePlatformFeeKobo(transaction);
      const creatorPayableKobo = resolveCreatorPayableKobo(transaction);
      const chargedAmountKobo = resolveChargedAmountKobo(transaction);
      if (transaction.amount !== chargedAmountKobo)
        updates.amount = chargedAmountKobo;
      const resolvedCreatorId =
        transaction.creatorId || transaction.event?.creatorId || null;
      const paymentType = this.resolvePaymentType(
        transaction.paymentType,
        metadata,
      );
      const payoutIsActive =
        payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE;
      const creatorKycTier = this.resolveKycTier(
        payoutProfile?.kycVerification,
        payoutProfile,
      );
      const shouldBeReady =
        payoutIsActive &&
        creatorKycTier === KycTierDto.FULL &&
        transaction.riskStatus === RiskStatus.CLEAR;
      const shouldHoldRisk =
        payoutIsActive && transaction.riskStatus !== RiskStatus.CLEAR;
      const inferredSettlementStatus =
        transaction.status !== TransactionStatusType.SUCCESS
          ? transaction.settlementStatus
          : transaction.settlementStatus === SettlementStatus.NOT_READY ||
              transaction.settlementStatus === SettlementStatus.HELD_KYC
            ? shouldBeReady
              ? SettlementStatus.READY
              : shouldHoldRisk
                ? SettlementStatus.HELD_RISK
                : SettlementStatus.HELD_KYC
            : transaction.settlementStatus;

      if (resolvedCreatorId && transaction.creatorId !== resolvedCreatorId) {
        updates.creator = {
          connect: { id: resolvedCreatorId },
        };
      }

      if (transaction.platformFee !== platformFeeKobo) {
        updates.platformFee = platformFeeKobo;
      }

      if (transaction.creatorPayable !== creatorPayableKobo) {
        updates.creatorPayable = creatorPayableKobo;
      }

      if (!transaction.paymentType) {
        updates.paymentType = paymentType;
      }

      if (transaction.settlementStatus !== inferredSettlementStatus) {
        updates.settlementStatus = inferredSettlementStatus;
      }

      if (metadata.amountUnit !== 'KOBO') {
        metadata.amountUnit = 'KOBO';
        updates.metadata = metadata;
      }

      if (Object.keys(updates).length > 0) {
        await db.transactionReference.update({
          where: { id: transaction.id },
          data: updates,
        });
      }
    }
  }

  private normalizeJsonObject(value?: Prisma.JsonValue | unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, any>) }
      : {};
  }

  private canReusePayoutVerification(
    existingProfile: any,
    ownershipType: AccountOwnershipType,
    bankCode?: string | null,
    accountNumber?: string | null,
  ) {
    return Boolean(
      existingProfile?.accountVerifiedAt &&
        existingProfile.accountName &&
        existingProfile.accountOwnershipType === ownershipType &&
        existingProfile.bankCode === bankCode &&
        existingProfile.accountNumber === accountNumber,
    );
  }

  private isPayoutAccountConfirmed(profile?: any | null) {
    if (!this.hasVerifiedPayoutAccount(profile)) {
      return false;
    }

    const confirmation = this.normalizeJsonObject(
      profile.metadata,
    ).accountNameConfirmation;
    if (
      !confirmation ||
      typeof confirmation !== 'object' ||
      Array.isArray(confirmation)
    ) {
      return false;
    }

    return (
      confirmation.bankCode === profile.bankCode &&
      confirmation.accountNumberHash ===
        this.hashKycSubject(profile.accountNumber)
    );
  }

  private hasVerifiedPayoutAccount(profile?: any | null) {
    return Boolean(profile?.accountVerifiedAt && profile.accountName);
  }

  private resolveKycTier(
    verification?: any | null,
    payoutProfile?: any | null,
  ) {
    const verificationMetadata = this.normalizeJsonObject(
      verification?.metadata,
    );
    const payoutMetadata = this.normalizeJsonObject(payoutProfile?.metadata);
    const tier =
      verificationMetadata.kycTier ||
      verificationMetadata.approvedTier ||
      payoutMetadata.kycTier ||
      payoutMetadata.approvedTier;

    if (tier === KycTierDto.FULL || tier === KycTierDto.BASIC) {
      return tier as KycTier;
    }

    return KycTierDto.NONE;
  }

  private buildStaticKycTierSummary(
    verification?: any | null,
    payoutProfile?: any | null,
  ): KycTierSummary {
    return {
      kycTier: this.resolveKycTier(verification, payoutProfile),
      basicKycSettlementCap: BASIC_KYC_SETTLEMENT_CAP_KOBO / 100,
      basicKycSettlementUsage: 0,
      basicKycSettlementRemaining: BASIC_KYC_SETTLEMENT_CAP_KOBO / 100,
      livenessRequired: false,
      livenessRequiredReason: null,
    };
  }

  private async getKycTierSummary(
    userId: string,
    verification?: any | null,
    payoutProfile?: any | null,
  ): Promise<KycTierSummary> {
    const [usageKobo, heldClearKobo] = await Promise.all([
      this.calculateBasicKycExposureKobo(userId),
      this.calculateHeldClearSettlementKobo(userId),
    ]);
    const kycTier = this.resolveKycTier(verification, payoutProfile);
    const remainingKobo = Math.max(
      BASIC_KYC_SETTLEMENT_CAP_KOBO - usageKobo,
      0,
    );
    const livenessRequired =
      kycTier === KycTierDto.BASIC &&
      (usageKobo >= BASIC_KYC_SETTLEMENT_CAP_KOBO ||
        (heldClearKobo > 0 && heldClearKobo > remainingKobo));

    return {
      kycTier,
      basicKycSettlementCap: BASIC_KYC_SETTLEMENT_CAP_KOBO / 100,
      basicKycSettlementUsage: usageKobo / 100,
      basicKycSettlementRemaining: remainingKobo / 100,
      livenessRequired,
      livenessRequiredReason: livenessRequired
        ? 'BASIC_TIER_CAP_REACHED'
        : null,
    };
  }

  private async calculateBasicKycExposureKobo(userId: string) {
    const aggregate = await this.prisma.transactionReference.aggregate({
      _sum: { creatorPayable: true },
      where: {
        creatorId: userId,
        status: TransactionStatusType.SUCCESS,
        settlementStatus: {
          in: [
            SettlementStatus.READY,
            SettlementStatus.PROCESSING,
            SettlementStatus.SETTLED,
          ],
        },
      },
    });

    return aggregate._sum.creatorPayable || 0;
  }

  private async calculateHeldClearSettlementKobo(userId: string) {
    const aggregate = await this.prisma.transactionReference.aggregate({
      _sum: { creatorPayable: true },
      where: {
        creatorId: userId,
        status: TransactionStatusType.SUCCESS,
        riskStatus: RiskStatus.CLEAR,
        settlementStatus: SettlementStatus.HELD_KYC,
      },
    });

    return aggregate._sum.creatorPayable || 0;
  }

  private hashVerificationInput(
    scope: string,
    mode: string,
    value?: string | null,
  ) {
    const normalized = `${scope}:${mode}:${value || ''}`
      .replace(/\s+/g, '')
      .toUpperCase();
    const secret = process.env.KYC_ENTITY_HASH_SECRET || process.env.JWT_SECRET;
    return secret
      ? crypto.createHmac('sha256', secret).update(normalized).digest('hex')
      : crypto.createHash('sha256').update(normalized).digest('hex');
  }

  private getCachedVerificationAttempt(
    metadata: Prisma.JsonValue | null | undefined,
    key: string,
    inputHash?: string | null,
  ) {
    if (!inputHash) {
      return null;
    }

    const cache = this.normalizeJsonObject(
      this.normalizeJsonObject(metadata).verificationCache,
    );
    const attempt = this.normalizeJsonObject(cache[key]);

    return attempt.inputHash === inputHash ? attempt : null;
  }

  private mergeVerificationCache(
    metadata: Prisma.JsonValue | null | undefined,
    key: string,
    attempt: Record<string, any>,
  ) {
    const cache = this.normalizeJsonObject(
      this.normalizeJsonObject(metadata).verificationCache,
    );

    return {
      ...cache,
      [key]: attempt,
    };
  }

  private assertIdentityReferenceIsLocallyValid(
    mode: string,
    identityReference?: string | null,
  ) {
    const normalized = identityReference?.replace(/\s+/g, '').trim();

    if (!normalized) {
      throw new BadRequestException(
        'Enter the identity number for the selected verification method',
      );
    }

    if (mode.includes('BVN') && !/^\d{11}$/.test(normalized)) {
      throw new BadRequestException('Enter a valid 11 digit BVN');
    }

    if (
      mode.includes('NIN') &&
      !mode.includes('VNIN') &&
      !/^\d{11}$/.test(normalized)
    ) {
      throw new BadRequestException('Enter a valid 11 digit NIN');
    }

    if (mode.includes('PHONE') && !/^\+?\d{10,15}$/.test(normalized)) {
      throw new BadRequestException('Enter a valid phone number');
    }

    if (mode.includes('PASSPORT') && normalized.length < 5) {
      throw new BadRequestException('Enter a valid passport number');
    }
  }

  private assertBusinessReferenceIsLocallyValid(regNumber?: string | null) {
    const normalized = regNumber?.replace(/\s+/g, '').trim();

    if (!normalized || !/^[A-Za-z0-9/-]{4,64}$/.test(normalized)) {
      throw new BadRequestException('Enter a valid CAC registration number');
    }
  }

  private resolvePaymentType(
    paymentType: PaymentType | null,
    metadata: Record<string, any>,
  ) {
    if (paymentType) {
      return paymentType;
    }

    if (metadata.type === 'REGISTRATION') {
      return PaymentType.REGISTRATION;
    }

    if (metadata.type === 'DONATION') {
      return PaymentType.DONATION;
    }

    return PaymentType.TICKET;
  }

  private formatPayoutProfile(profile: CreatorSettlementProfile) {
    return {
      status: profile.status,
      accountOwnershipType: profile.accountOwnershipType,
      businessName: profile.businessName,
      legalName: profile.legalName,
      bankName: profile.bankName,
      bankCode: profile.bankCode,
      accountName: profile.accountName,
      accountNumberMasked:
        profile.accountNumberMasked ||
        this.maskAccountNumber(profile.accountNumber),
      accountNumber: profile.accountNumber,
      bvnLast4: profile.bvnLast4,
      kycStatus: profile.kycStatus,
      nameMatchStatus: profile.nameMatchStatus,
      accountVerifiedAt: profile.accountVerifiedAt,
      rejectionReason: profile.rejectionReason,
      submittedAt: profile.submittedAt,
      approvedAt: profile.approvedAt,
      accountNameConfirmed: this.isPayoutAccountConfirmed(profile),
      kycTier: this.resolveKycTier(undefined, profile),
    };
  }

  private formatAlatProfile(profile: any) {
    return {
      status: profile.status,
      displayName: profile.displayName,
      subaccountReference: profile.subaccountReference,
      accountNumber: this.maskAccountNumber(profile.accountNumber),
      accountName: profile.accountName,
      activatedAt: profile.activatedAt,
      notes: profile.notes,
    };
  }

  private formatInternalAlatQueueItem(user: any) {
    const payoutProfile = user.settlementProfile || null;
    const alatProfile = user.alatProfile || null;
    const currentAlatStatus =
      alatProfile?.status || CreatorAlatProfileStatus.NOT_STARTED;

    return {
      id: user.id,
      needsAction:
        payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE &&
        currentAlatStatus !== CreatorAlatProfileStatus.ACTIVE,
      eventCount: user._count?.eventsCreated || 0,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        createdAt: user.createdAt,
      },
      payoutProfile: payoutProfile
        ? this.formatPayoutProfile(payoutProfile)
        : null,
      alatProfile: alatProfile
        ? {
            status: alatProfile.status,
            displayName: alatProfile.displayName,
            businessId: alatProfile.businessId,
            subaccountReference: alatProfile.subaccountReference,
            accountNumberMasked: this.maskAccountNumber(
              alatProfile.accountNumber,
            ),
            accountName: alatProfile.accountName,
            activatedAt: alatProfile.activatedAt,
            reviewedAt: alatProfile.reviewedAt,
            notes: alatProfile.notes,
          }
        : null,
    };
  }

  private formatKyc(
    verification: any,
    payoutProfile?: any | null,
    tierSummary?: KycTierSummary,
  ) {
    const resolvedTierSummary =
      tierSummary ||
      this.buildStaticKycTierSummary(verification, payoutProfile);
    const steps = this.buildKycSteps(
      verification,
      payoutProfile,
      resolvedTierSummary,
    );
    const currentStep =
      steps.find((step) => step.active)?.code ||
      steps.find((step) => step.status === 'FAILED')?.code ||
      null;

    return {
      status: verification.status,
      accountOwnershipType:
        verification.accountOwnershipType || AccountOwnershipType.UNKNOWN,
      verificationMode: verification.verificationMode || null,
      steps,
      businessStatus:
        verification.businessStatus || KycVerificationStatus.NOT_STARTED,
      identityStatus:
        verification.identityStatus || KycVerificationStatus.NOT_STARTED,
      livenessStatus:
        verification.livenessStatus || KycVerificationStatus.NOT_STARTED,
      amlStatus: verification.amlStatus || KycVerificationStatus.NOT_STARTED,
      dedupStatus:
        verification.dedupStatus || KycVerificationStatus.NOT_STARTED,
      nameMatchStatus:
        verification.nameMatchStatus || NameMatchStatus.NOT_CHECKED,
      verifiedFullName: verification.verifiedFullName || null,
      verifiedBusinessName: verification.verifiedBusinessName || null,
      rejectionReason: verification.rejectionReason || null,
      nameMatchReason: verification.nameMatchReason || null,
      currentStep,
      canSubmitBasicKyc: false,
      canSubmitFullKyc: false,
      ...resolvedTierSummary,
    };
  }

  private formatInternalKycQueueItem(verification: any) {
    const payoutProfile = verification.settlementProfile || null;
    const formattedPayoutProfile = payoutProfile
      ? this.formatPayoutProfile(payoutProfile)
      : null;
    const formattedVerification = this.formatKyc(verification, payoutProfile);

    return {
      id: verification.id,
      userId: verification.userId,
      hasManualReview: Boolean(verification.reviewedAt),
      user: {
        id: verification.user?.id || verification.userId,
        username: verification.user?.username || null,
        fullName: verification.user?.fullName || null,
        email: verification.user?.email || null,
        createdAt: verification.user?.createdAt || null,
      },
      payoutProfile: formattedPayoutProfile
        ? {
            ...formattedPayoutProfile,
            rejectedAt: payoutProfile.rejectedAt,
            updatedAt: payoutProfile.updatedAt,
          }
        : null,
      verification: {
        ...formattedVerification,
        provider: verification.provider,
        submittedAt: verification.submittedAt,
        reviewedAt: verification.reviewedAt,
        createdAt: verification.createdAt,
        updatedAt: verification.updatedAt,
        identityReferenceMasked: verification.identityReferenceMasked || null,
        providerSubjectLast4: verification.providerSubjectLast4 || null,
        businessReferenceLast4: verification.businessReferenceLast4 || null,
        nameMatchReason: verification.nameMatchReason || null,
      },
    };
  }

  private formatAccountChange(change: any) {
    return {
      id: change.id,
      previousBankName: change.previousBankName,
      previousAccountNumberMasked: change.previousAccountNumberMasked,
      previousAccountName: change.previousAccountName,
      newBankName: change.newBankName,
      newAccountNumberMasked: change.newAccountNumberMasked,
      newAccountName: change.newAccountName,
      nameChanged: change.nameChanged,
      ownershipTypeChanged: change.ownershipTypeChanged,
      requiresReview: change.requiresReview,
      changedBy: change.changedBy,
      reason: change.reason,
      createdAt: change.createdAt,
    };
  }

  private formatTransaction(transaction: WalletTransaction) {
    const grossAmountKobo = resolveGrossAmountKobo(transaction);
    const creatorPayableKobo = resolveCreatorPayableKobo(transaction);
    const platformFeeKobo = resolvePlatformFeeKobo(transaction);

    return {
      id: transaction.id,
      paymentType: transaction.paymentType || PaymentType.TICKET,
      paymentProvider: transaction.paymentProvider,
      grossAmount: grossAmountKobo / 100,
      platformFee: platformFeeKobo / 100,
      providerFee: transaction.providerFee / 100,
      creatorPayable: creatorPayableKobo / 100,
      settlementStatus: transaction.settlementStatus,
      riskStatus: transaction.riskStatus,
      riskScore: transaction.riskScore,
      riskReasons: this.normalizeRiskReasons(transaction.riskReasons),
      riskReviewNote: this.extractLatestRiskReviewNote(transaction.metadata),
      reviewedAt: transaction.reviewedAt,
      eventTitle: transaction.event?.title || null,
      buyerUsername:
        transaction.user?.username || transaction.user?.fullName || null,
      createdAt: transaction.createdAt,
    };
  }

  private formatSettlement(settlement: any) {
    return {
      id: settlement.id,
      reference: settlement.reference,
      amount: settlement.amount / 100,
      status: settlement.status,
      destinationBankName: settlement.destinationBankName,
      destinationAccountName: settlement.destinationAccountName,
      destinationAccountNumber: this.maskAccountNumber(
        settlement.destinationAccountNumber,
      ),
      transactionCount: settlement.allocations?.length || 0,
      createdAt: settlement.createdAt,
      processedAt: settlement.processedAt,
    };
  }

  private maskAccountNumber(accountNumber?: string | null) {
    if (!accountNumber) {
      return null;
    }

    if (accountNumber.length <= 4) {
      return accountNumber;
    }

    return `${'*'.repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
  }

  private normalizeBankCode(bankCode?: string | null) {
    const normalized = bankCode?.trim();
    return normalized || null;
  }

  private normalizePayoutAccountNumber(accountNumber?: string | null) {
    const normalized = accountNumber?.replace(/\s+/g, '').trim();
    return normalized || null;
  }

  private resolveValidPayoutAccountDetails(
    bankCode?: string | null,
    accountNumber?: string | null,
  ) {
    if (!bankCode) {
      throw new BadRequestException('Bank code is required');
    }

    if (!accountNumber) {
      throw new BadRequestException('Account number is required');
    }

    if (!/^\d{10}$/.test(accountNumber)) {
      throw new BadRequestException(
        'Enter a valid 10 digit payout account number',
      );
    }

    return {
      bankCode,
      accountNumber,
    };
  }

  private async resolvePayoutAccountWithPaystack(
    bankCode: string,
    accountNumber: string,
  ) {
    const response = await this.paystackService.resolveBankAccount({
      accountNumber,
      bankCode,
    });

    if (!response.status || !response.data?.account_name) {
      throw new BadRequestException(
        response.message || 'We could not resolve the submitted payout account',
      );
    }

    return {
      accountNumber: response.data.account_number,
      accountName: response.data.account_name,
    };
  }

  private buildPayoutAccountConfirmation(input: {
    accountName?: string | null;
    bankCode?: string | null;
    accountNumber?: string | null;
  }) {
    return {
      confirmedAt: new Date().toISOString(),
      accountName: input.accountName,
      bankCode: input.bankCode,
      accountNumberHash: this.hashKycSubject(input.accountNumber),
    };
  }

  private summarizePaystackAccountResolution(input: {
    accountNumber: string;
    accountName: string;
  }) {
    return {
      provider: 'PAYSTACK',
      accountNumberHash: this.hashKycSubject(input.accountNumber),
      accountName: input.accountName,
      resolvedAt: new Date().toISOString(),
    };
  }

  private async assertNoDuplicatePayoutAccount(
    userId: string,
    bankCode?: string | null,
    accountNumber?: string | null,
  ) {
    const normalizedBankCode = this.normalizeBankCode(bankCode);
    const normalizedAccountNumber =
      this.normalizePayoutAccountNumber(accountNumber);

    if (!normalizedBankCode || !normalizedAccountNumber) {
      return;
    }

    const existingProfile =
      await this.prisma.creatorSettlementProfile.findFirst({
        where: {
          userId: { not: userId },
          bankCode: normalizedBankCode,
          accountNumber: normalizedAccountNumber,
        },
        select: {
          userId: true,
        },
      });

    if (existingProfile) {
      throw new BadRequestException(
        'This payout account is already linked to another GatherGo account. Use a different account number before continuing.',
      );
    }
  }

  private normalizeRiskReasons(
    riskReasons: Prisma.JsonValue | null | undefined,
  ) {
    if (!Array.isArray(riskReasons)) {
      return [];
    }

    return riskReasons
      .filter((reason): reason is string => typeof reason === 'string')
      .map((reason) =>
        reason.startsWith('device:') ? 'device_signal_recorded' : reason,
      );
  }

  private extractLatestRiskReviewNote(
    metadata: Prisma.JsonValue | null | undefined,
  ) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const lastRiskReview = (metadata as Record<string, any>).lastRiskReview;
    if (
      !lastRiskReview ||
      typeof lastRiskReview !== 'object' ||
      Array.isArray(lastRiskReview)
    ) {
      return null;
    }

    return typeof lastRiskReview.note === 'string' ? lastRiskReview.note : null;
  }

  private maskIdentityReference(value?: string | null) {
    if (!value) {
      return null;
    }

    if (value.length <= 4) {
      return value;
    }

    return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
  }

  private getLast4(value?: string | null) {
    if (!value) {
      return null;
    }

    const normalized = value.replace(/[^A-Za-z0-9]/g, '').trim();

    if (!normalized) {
      return null;
    }

    return normalized.slice(-4).toUpperCase();
  }

  private normalizeKycHashInput(value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    const digitsOnly = trimmed.replace(/\D+/g, '');
    if (digitsOnly.length >= 7) {
      return digitsOnly;
    }

    const normalized = trimmed.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return normalized || null;
  }

  private hashKycSubject(value?: string | null) {
    const normalized = this.normalizeKycHashInput(value);
    if (!normalized) {
      return null;
    }

    const secret = process.env.KYC_ENTITY_HASH_SECRET || process.env.JWT_SECRET;
    return secret
      ? crypto.createHmac('sha256', secret).update(normalized).digest('hex')
      : crypto.createHash('sha256').update(normalized).digest('hex');
  }

  private extractProviderSubject(response?: DikriptNinResponse | null) {
    const identityRecord = this.extractIdentityRecord(response);
    return (
      identityRecord?.bvn ||
      identityRecord?.nin ||
      identityRecord?.phoneNumber ||
      identityRecord?.phone ||
      identityRecord?.passportNo ||
      null
    );
  }

  private hashNameDob(fullName?: string | null, dateOfBirth?: Date | null) {
    if (!fullName || !dateOfBirth) {
      return null;
    }

    const normalizedName = this.normalizeNameTokens(fullName).join(' ');
    if (!normalizedName) {
      return null;
    }

    const isoDate = dateOfBirth.toISOString().slice(0, 10);
    return this.hashKycSubject(`${normalizedName}|${isoDate}`);
  }

  private async detectDuplicateKycSignals(input: {
    userId: string;
    providerSubjectHash?: string | null;
    businessReferenceHash?: string | null;
    nameDobHash?: string | null;
  }) {
    const filters: Prisma.CreatorKycVerificationWhereInput[] = [];

    if (input.providerSubjectHash) {
      filters.push({ providerSubjectHash: input.providerSubjectHash });
    }

    if (input.businessReferenceHash) {
      filters.push({ businessReferenceHash: input.businessReferenceHash });
    }

    if (input.nameDobHash) {
      filters.push({ nameDobHash: input.nameDobHash });
    }

    if (!filters.length) {
      return {
        status: KycVerificationStatus.NOT_STARTED,
        reason: null,
        metadata: {
          status: 'CLEAR',
          matchedSignals: [],
          matchedCount: 0,
        },
      };
    }

    const matches = await this.prisma.creatorKycVerification.findMany({
      where: {
        userId: { not: input.userId },
        OR: filters,
      },
      select: {
        userId: true,
        providerSubjectHash: true,
        businessReferenceHash: true,
        nameDobHash: true,
      },
    });

    const matchedSignals = [
      input.providerSubjectHash &&
      matches.some(
        (entry) => entry.providerSubjectHash === input.providerSubjectHash,
      )
        ? 'PROVIDER_SUBJECT'
        : null,
      input.businessReferenceHash &&
      matches.some(
        (entry) => entry.businessReferenceHash === input.businessReferenceHash,
      )
        ? 'BUSINESS_REFERENCE'
        : null,
      input.nameDobHash &&
      matches.some((entry) => entry.nameDobHash === input.nameDobHash)
        ? 'NAME_DOB_FALLBACK'
        : null,
    ].filter((signal): signal is string => Boolean(signal));

    const hasDuplicate = matchedSignals.length > 0;

    return {
      status: hasDuplicate
        ? KycVerificationStatus.SUBMITTED
        : KycVerificationStatus.VERIFIED,
      reason: hasDuplicate
        ? matchedSignals.includes('BUSINESS_REFERENCE')
          ? 'Potential duplicate business entity detected. Final approval requires manual review.'
          : matchedSignals.includes('NAME_DOB_FALLBACK')
            ? 'Potential duplicate identity detected from verified name and date of birth. Final approval requires manual review.'
            : 'Potential duplicate identity detected. Final approval requires manual review.'
        : null,
      metadata: {
        status: hasDuplicate ? 'REVIEW_REQUIRED' : 'CLEAR',
        matchedSignals,
        matchedCount: matches.length,
        matchedUserIds: matches.map((entry) => entry.userId),
      },
    };
  }

  private buildOnboardingTasks(
    payoutStatus: CreatorSettlementProfileStatus,
    kycStatus: KycVerificationStatus,
    alatStatus: CreatorAlatProfileStatus,
    hasBusinessId: boolean,
    livenessRequired: boolean,
    kycTier: KycTier,
  ) {
    const basicTierApproved =
      kycTier === KycTierDto.BASIC || kycTier === KycTierDto.FULL;
    const payoutTaskStatus =
      payoutStatus === CreatorSettlementProfileStatus.NOT_STARTED
        ? 'PENDING'
        : 'COMPLETED';
    const kycTaskStatus =
      payoutStatus === CreatorSettlementProfileStatus.NOT_STARTED
        ? 'LOCKED'
        : kycStatus === KycVerificationStatus.VERIFIED || basicTierApproved
          ? 'COMPLETED'
          : 'PENDING';
    const livenessTaskStatus = !basicTierApproved
      ? 'LOCKED'
      : livenessRequired
        ? 'PENDING'
        : 'COMPLETED';
    const alatTaskStatus =
      payoutStatus !== CreatorSettlementProfileStatus.ACTIVE ||
      kycTier !== KycTierDto.FULL
        ? 'LOCKED'
        : alatStatus === CreatorAlatProfileStatus.ACTIVE && hasBusinessId
          ? 'COMPLETED'
          : 'PENDING';

    return [
      {
        code: 'ADD_SETTLEMENT_ACCOUNT',
        title: 'Add settlement account',
        status: payoutTaskStatus,
        blocking: true,
      },
      {
        code: 'COMPLETE_KYC',
        title: 'Complete Basic KYC',
        status: kycTaskStatus,
        blocking: true,
      },
      {
        code: 'COMPLETE_LIVENESS',
        title: 'Complete face verification',
        status: livenessTaskStatus,
        blocking: livenessRequired,
      },
      {
        code: 'ALAT_ACTIVATION',
        title: 'Await ALAT transfer activation',
        status: alatTaskStatus,
        blocking: false,
      },
    ];
  }

  private buildInternalKycQueueWhere(dto: InternalKycQueueQueryDto) {
    const hasExplicitScope = Boolean(
      dto.userId || dto.status || dto.profileStatus || dto.nameMatchStatus,
    );

    return {
      ...(dto.userId ? { userId: dto.userId } : {}),
      ...(!hasExplicitScope && {
        OR: [
          {
            status: {
              in: [
                KycVerificationStatus.SUBMITTED,
                KycVerificationStatus.PENDING_PROVIDER,
                KycVerificationStatus.IN_PROGRESS,
              ],
            },
          },
          {
            settlementProfile: {
              is: {
                status: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
              },
            },
          },
        ],
      }),
      ...(dto.status && {
        status: dto.status as KycVerificationStatus,
      }),
      ...(dto.accountOwnershipType && {
        accountOwnershipType: dto.accountOwnershipType as AccountOwnershipType,
      }),
      ...(dto.nameMatchStatus && {
        nameMatchStatus: dto.nameMatchStatus as NameMatchStatus,
      }),
      ...(dto.profileStatus && {
        settlementProfile: {
          is: {
            status: dto.profileStatus as CreatorSettlementProfileStatus,
          },
        },
      }),
      ...(dto.reviewed === true
        ? {
            reviewedAt: {
              not: null,
            },
          }
        : dto.reviewed === false
          ? {
              reviewedAt: null,
            }
          : {}),
    } satisfies Prisma.CreatorKycVerificationWhereInput;
  }

  private buildKycSteps(
    verification: any,
    payoutProfile?: any | null,
    tierSummary?: KycTierSummary,
  ) {
    const accountOwnershipType =
      verification.accountOwnershipType || AccountOwnershipType.UNKNOWN;
    const businessStatus =
      verification.businessStatus || KycVerificationStatus.NOT_STARTED;
    const identityStatus =
      verification.identityStatus || KycVerificationStatus.NOT_STARTED;
    const livenessStatus =
      verification.livenessStatus || KycVerificationStatus.NOT_STARTED;
    const nameMatchStatus =
      verification.nameMatchStatus || NameMatchStatus.NOT_CHECKED;
    const profileStatus =
      payoutProfile?.status || CreatorSettlementProfileStatus.NOT_STARTED;
    const hasVerifiedPayoutAccount =
      this.hasVerifiedPayoutAccount(payoutProfile);
    const approvedTier =
      tierSummary?.kycTier || this.resolveKycTier(verification, payoutProfile);
    const basicApproved =
      profileStatus === CreatorSettlementProfileStatus.ACTIVE &&
      (approvedTier === KycTierDto.BASIC || approvedTier === KycTierDto.FULL);
    const fullApproved = approvedTier === KycTierDto.FULL;

    const createStep = (
      code: string,
      title: string,
      status: string,
      active = false,
      requiresPaidProvider = false,
    ) => ({
      code,
      title,
      status,
      active,
      requiresPaidProvider,
    });

    const payoutStatus = hasVerifiedPayoutAccount ? 'COMPLETED' : 'ACTIVE';
    const nameMatchStepStatus =
      nameMatchStatus === NameMatchStatus.MATCHED
        ? 'COMPLETED'
        : nameMatchStatus === NameMatchStatus.REVIEW_REQUIRED
          ? 'REVIEW'
          : nameMatchStatus === NameMatchStatus.MISMATCH
            ? 'FAILED'
            : 'PENDING';
    const livenessStepStatus = fullApproved
      ? 'COMPLETED'
      : livenessStatus === KycVerificationStatus.PENDING_PROVIDER
        ? 'PENDING'
        : livenessStatus === KycVerificationStatus.REJECTED
          ? 'FAILED'
          : livenessStatus === KycVerificationStatus.VERIFIED
            ? 'COMPLETED'
            : 'ACTIVE';

    if (accountOwnershipType === AccountOwnershipType.BUSINESS) {
      const businessStepStatus = this.mapKycStatusToStep(businessStatus);
      const representativeStepStatus = this.mapKycStatusToStep(identityStatus);
      const representativeAllowsFull =
        identityStatus === KycVerificationStatus.VERIFIED ||
        identityStatus === KycVerificationStatus.SUBMITTED;
      const businessNameMatchUnlocked =
        businessStatus === KycVerificationStatus.VERIFIED;
      const basicBusinessReady =
        businessNameMatchUnlocked &&
        nameMatchStatus === NameMatchStatus.MATCHED;
      const representativeAvailable =
        fullApproved || (basicApproved && basicBusinessReady);
      const representativeActive =
        representativeAvailable &&
        !fullApproved &&
        identityStatus !== KycVerificationStatus.VERIFIED &&
        identityStatus !== KycVerificationStatus.SUBMITTED &&
        identityStatus !== KycVerificationStatus.PENDING_PROVIDER;
      const livenessAvailable =
        fullApproved || (representativeAvailable && representativeAllowsFull);
      const livenessActive =
        !fullApproved &&
        livenessAvailable &&
        livenessStatus !== KycVerificationStatus.PENDING_PROVIDER &&
        livenessStatus !== KycVerificationStatus.VERIFIED;

      return [
        createStep(
          'PAYOUT_ACCOUNT',
          'Add payout account',
          payoutStatus,
          !hasVerifiedPayoutAccount,
          true,
        ),
        createStep(
          'BUSINESS_IDENTITY',
          'Verify CAC record',
          !hasVerifiedPayoutAccount ? 'LOCKED' : businessStepStatus,
          hasVerifiedPayoutAccount &&
            businessStatus !== KycVerificationStatus.VERIFIED &&
            businessStatus !== KycVerificationStatus.PENDING_PROVIDER,
          true,
        ),
        createStep(
          'BUSINESS_NAME_MATCH',
          'Match business name',
          businessNameMatchUnlocked ? nameMatchStepStatus : 'LOCKED',
          businessNameMatchUnlocked &&
            nameMatchStatus === NameMatchStatus.MISMATCH,
          false,
        ),
        createStep(
          'REPRESENTATIVE_IDENTITY',
          'Verify representative',
          !representativeAvailable ? 'LOCKED' : representativeStepStatus,
          representativeActive,
          true,
        ),
        createStep(
          'LIVENESS',
          tierSummary?.livenessRequired
            ? 'Complete face verification'
            : 'Upgrade with face verification',
          livenessAvailable ? livenessStepStatus : 'LOCKED',
          livenessActive,
          true,
        ),
      ];
    }

    const identityStepStatus = this.mapKycStatusToStep(identityStatus);
    const identityUnlocked = hasVerifiedPayoutAccount;
    const nameMatchUnlocked = identityStatus === KycVerificationStatus.VERIFIED;
    const livenessUnlocked = basicApproved && !fullApproved;

    return [
      createStep(
        'PAYOUT_ACCOUNT',
        'Add payout account',
        payoutStatus,
        !hasVerifiedPayoutAccount,
        true,
      ),
      createStep(
        'PERSONAL_IDENTITY',
        'Verify identity',
        !identityUnlocked ? 'LOCKED' : identityStepStatus,
        identityUnlocked &&
          identityStatus !== KycVerificationStatus.VERIFIED &&
          identityStatus !== KycVerificationStatus.PENDING_PROVIDER,
        true,
      ),
      createStep(
        'NAME_MATCH',
        'Match account name',
        nameMatchUnlocked ? nameMatchStepStatus : 'LOCKED',
        nameMatchUnlocked && nameMatchStatus === NameMatchStatus.MISMATCH,
        false,
      ),
      createStep(
        'LIVENESS',
        tierSummary?.livenessRequired
          ? 'Complete face verification'
          : 'Upgrade with face verification',
        livenessUnlocked ? livenessStepStatus : 'LOCKED',
        livenessUnlocked &&
          livenessStatus !== KycVerificationStatus.PENDING_PROVIDER &&
          livenessStatus !== KycVerificationStatus.VERIFIED,
        true,
      ),
    ];
  }

  private mapKycStatusToStep(status: KycVerificationStatus) {
    switch (status) {
      case KycVerificationStatus.VERIFIED:
        return 'COMPLETED';
      case KycVerificationStatus.REJECTED:
        return 'FAILED';
      case KycVerificationStatus.SUBMITTED:
        return 'REVIEW';
      case KycVerificationStatus.PENDING_PROVIDER:
      case KycVerificationStatus.IN_PROGRESS:
        return 'PENDING';
      default:
        return 'PENDING';
    }
  }

  private resolveIdentityNames(
    firstName?: string | null,
    lastName?: string | null,
    fallbackFullName?: string | null,
  ) {
    if (firstName && lastName) {
      return {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      };
    }

    if (!fallbackFullName) {
      return null;
    }

    const tokens = fallbackFullName.trim().split(/\s+/).filter(Boolean);

    if (tokens.length < 2) {
      return null;
    }

    return {
      firstName: tokens[0],
      lastName: tokens.slice(1).join(' '),
    };
  }

  private combineNameParts(...parts: Array<string | null | undefined>) {
    const cleaned = parts
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));

    return cleaned.length ? cleaned.join(' ') : null;
  }

  private parseDate(value?: string | null) {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolvePersonalVerificationMode(dto: StartPersonalKycDto) {
    if (dto.verificationMode) {
      if (dto.verificationMode.startsWith('BUSINESS_')) {
        throw new BadRequestException(
          'A personal KYC request cannot use a business verification mode',
        );
      }

      return dto.verificationMode;
    }

    if (dto.bvn) {
      return 'PERSONAL_BVN';
    }

    if (dto.phoneNumber) {
      return 'PERSONAL_PHONE';
    }

    if (dto.passportNumber) {
      return 'PERSONAL_PASSPORT';
    }

    if (dto.vnin) {
      return 'PERSONAL_VNIN';
    }

    if (dto.nin) {
      return 'PERSONAL_NIN';
    }

    return 'PERSONAL_PHONE';
  }

  private resolveBusinessVerificationMode(
    dto: StartBusinessRepresentativeKycDto,
  ) {
    if (dto.verificationMode) {
      if (dto.verificationMode.startsWith('PERSONAL_')) {
        throw new BadRequestException(
          'A business KYC request cannot use a personal verification mode',
        );
      }

      return dto.verificationMode;
    }

    if (dto.representativeBvn) {
      return 'BUSINESS_CAC_REP_BVN';
    }

    if (dto.representativePhoneNumber) {
      return 'BUSINESS_CAC_REP_PHONE';
    }

    if (dto.representativePassportNumber) {
      return 'BUSINESS_CAC_REP_PASSPORT';
    }

    if (dto.representativeVnin) {
      return 'BUSINESS_CAC_REP_VNIN';
    }

    if (dto.representativeNin) {
      return 'BUSINESS_CAC_REP_NIN';
    }

    return 'BUSINESS_CAC_REP_PHONE';
  }

  private resolveIdentityTypeFromMode(mode: string) {
    if (mode.includes('PASSPORT')) {
      return 'PASSPORT';
    }

    if (mode.includes('BVN')) {
      return 'BVN';
    }

    if (mode.includes('VNIN')) {
      return 'VNIN';
    }

    if (mode.includes('PHONE')) {
      return 'PHONE';
    }

    return 'NIN';
  }

  private resolveIdentityReferenceFromMode(
    mode: string,
    dto:
      | StartPersonalKycDto
      | StartBusinessKycDto
      | StartBusinessRepresentativeKycDto,
  ) {
    switch (mode) {
      case 'PERSONAL_PASSPORT':
        return 'passportNumber' in dto ? dto.passportNumber || null : null;
      case 'PERSONAL_VNIN':
        return 'vnin' in dto ? dto.vnin || null : null;
      case 'PERSONAL_NIN':
        return 'nin' in dto ? dto.nin || null : null;
      case 'PERSONAL_BVN':
        return 'bvn' in dto ? dto.bvn || null : null;
      case 'PERSONAL_PHONE':
      case 'PERSONAL_PHONE_NIN':
        return 'phoneNumber' in dto ? dto.phoneNumber || null : null;
      case 'BUSINESS_CAC_REP_PASSPORT':
        return 'representativePassportNumber' in dto
          ? dto.representativePassportNumber || null
          : null;
      case 'BUSINESS_CAC_REP_VNIN':
        return 'representativeVnin' in dto
          ? dto.representativeVnin || null
          : null;
      case 'BUSINESS_CAC_REP_NIN':
        return 'representativeNin' in dto
          ? dto.representativeNin || null
          : null;
      case 'BUSINESS_CAC_REP_BVN':
        return 'representativeBvn' in dto
          ? dto.representativeBvn || null
          : null;
      case 'BUSINESS_CAC_REP_PHONE':
      case 'BUSINESS_CAC_REP_PHONE_NIN':
        return 'representativePhoneNumber' in dto
          ? dto.representativePhoneNumber || null
          : null;
      default:
        return null;
    }
  }

  private async verifyPersonalIdentityWithDikript(input: {
    verificationMode: string;
    dto: StartPersonalKycDto;
    resolvedNames: { firstName: string; lastName: string };
    user: {
      fullName?: string | null;
      phoneNumber?: string | null;
      email?: string | null;
      gender?: string | null;
    } | null;
  }) {
    const commonInput = {
      firstName: input.resolvedNames.firstName,
      lastName: input.resolvedNames.lastName,
      dateOfBirth: input.dto.dateOfBirth || null,
      phone: input.dto.phoneNumber || input.user?.phoneNumber || null,
      email: input.user?.email || null,
      gender: input.user?.gender || null,
    };

    switch (input.verificationMode) {
      case 'PERSONAL_NIN':
        if (!input.dto.nin) {
          throw new BadRequestException(
            'NIN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyNin({
          nin: input.dto.nin,
          ...commonInput,
        });
      case 'PERSONAL_VNIN':
        if (!input.dto.vnin) {
          throw new BadRequestException(
            'vNIN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyVirtualNin({
          vnin: input.dto.vnin,
          ...commonInput,
        });
      case 'PERSONAL_BVN':
        if (!input.dto.bvn) {
          throw new BadRequestException(
            'BVN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyBvn({
          bvn: input.dto.bvn,
          ...commonInput,
        });
      case 'PERSONAL_PASSPORT':
        if (!input.dto.passportNumber) {
          throw new BadRequestException(
            'Passport number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyPassport({
          passportNumber: input.dto.passportNumber,
          ...commonInput,
        });
      case 'PERSONAL_PHONE_NIN':
        if (!(input.dto.phoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Phone number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyNinByPhone({
          phoneNumber: input.dto.phoneNumber || input.user?.phoneNumber || '',
          ...commonInput,
        });
      case 'PERSONAL_PHONE':
      default:
        if (!(input.dto.phoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Phone number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyPhone({
          phoneNumber: input.dto.phoneNumber || input.user?.phoneNumber || '',
          ...commonInput,
        });
    }
  }

  private async verifyBusinessRepresentativeWithDikript(input: {
    verificationMode: string;
    dto: StartBusinessRepresentativeKycDto;
    representativeNames: { firstName: string; lastName: string };
    user: {
      fullName?: string | null;
      phoneNumber?: string | null;
      email?: string | null;
      gender?: string | null;
    } | null;
  }) {
    const commonInput = {
      firstName: input.representativeNames.firstName,
      lastName: input.representativeNames.lastName,
      dateOfBirth: input.dto.representativeDateOfBirth || null,
      phone:
        input.dto.representativePhoneNumber || input.user?.phoneNumber || null,
      email: input.user?.email || null,
      gender: input.user?.gender || null,
    };

    switch (input.verificationMode) {
      case 'BUSINESS_CAC_REP_NIN':
        if (!input.dto.representativeNin) {
          throw new BadRequestException(
            'Representative NIN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyNin({
          nin: input.dto.representativeNin,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_VNIN':
        if (!input.dto.representativeVnin) {
          throw new BadRequestException(
            'Representative vNIN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyVirtualNin({
          vnin: input.dto.representativeVnin,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_BVN':
        if (!input.dto.representativeBvn) {
          throw new BadRequestException(
            'Representative BVN is required for this verification mode',
          );
        }
        return this.dikriptService.verifyBvn({
          bvn: input.dto.representativeBvn,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_PASSPORT':
        if (!input.dto.representativePassportNumber) {
          throw new BadRequestException(
            'Representative passport number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyPassport({
          passportNumber: input.dto.representativePassportNumber,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_PHONE_NIN':
        if (!(input.dto.representativePhoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Representative phone number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyNinByPhone({
          phoneNumber:
            input.dto.representativePhoneNumber ||
            input.user?.phoneNumber ||
            '',
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_PHONE':
      default:
        if (!(input.dto.representativePhoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Representative phone number is required for this verification mode',
          );
        }
        return this.dikriptService.verifyPhone({
          phoneNumber:
            input.dto.representativePhoneNumber ||
            input.user?.phoneNumber ||
            '',
          ...commonInput,
        });
    }
  }

  private extractIdentityRecord(response?: DikriptNinResponse | null) {
    if (!response) {
      return null;
    }

    return (
      response.nin ||
      response.bvn ||
      response.phone ||
      response.virtual_nin ||
      response.passport ||
      null
    );
  }

  private extractDikriptIdentityMatchStatus(response: DikriptNinResponse) {
    const summary = response.summary || {};
    const summaryValue = Object.values(summary).find((value) => Boolean(value));

    if (!summaryValue) {
      return '';
    }

    if (typeof summaryValue === 'string') {
      return summaryValue.toUpperCase();
    }

    return (summaryValue.status || '').toUpperCase();
  }

  private resolveDikriptIdentityStatus(response: DikriptNinResponse) {
    const verificationState = this.resolveDikriptVerificationState(
      response.status?.status,
    );
    const matchStatus = this.extractDikriptIdentityMatchStatus(response);
    const identityRecord = this.extractIdentityRecord(response);

    if (verificationState === 'pending') {
      return KycVerificationStatus.PENDING_PROVIDER;
    }

    if (
      verificationState === 'failed' ||
      matchStatus === 'NO_MATCH' ||
      !identityRecord?.firstname ||
      !identityRecord?.lastname
    ) {
      return KycVerificationStatus.REJECTED;
    }

    return KycVerificationStatus.VERIFIED;
  }

  private resolveDikriptBusinessStatus(response: DikriptCacResponse) {
    const verificationState = this.resolveDikriptVerificationState(
      response.status?.status,
    );
    const cacSummary = (response.summary?.cac_check || '').toLowerCase();

    if (verificationState === 'pending') {
      return KycVerificationStatus.PENDING_PROVIDER;
    }

    if (
      verificationState === 'failed' ||
      cacSummary !== 'verified' ||
      !response.cac?.companyName
    ) {
      return KycVerificationStatus.REJECTED;
    }

    return KycVerificationStatus.VERIFIED;
  }

  private resolveDikriptFaceVerificationStatus(
    response: DikriptFaceVerificationResponse,
  ) {
    const verificationState = this.resolveDikriptVerificationState(
      response.status?.status,
    );

    if (verificationState === 'pending') {
      return KycVerificationStatus.PENDING_PROVIDER;
    }

    if (
      verificationState === 'failed' ||
      response.summary?.face_verification_check?.match !== true
    ) {
      return KycVerificationStatus.REJECTED;
    }

    return KycVerificationStatus.VERIFIED;
  }

  private deriveVerificationWorkflowStatus(input: {
    accountOwnershipType: AccountOwnershipType;
    businessStatus?: KycVerificationStatus | null;
    identityStatus?: KycVerificationStatus | null;
    livenessStatus?: KycVerificationStatus | null;
  }) {
    const relevantStatuses =
      input.accountOwnershipType === AccountOwnershipType.BUSINESS
        ? [input.businessStatus, input.identityStatus, input.livenessStatus]
        : [input.identityStatus, input.livenessStatus];

    if (
      relevantStatuses.some(
        (status) => status === KycVerificationStatus.REJECTED,
      )
    ) {
      return KycVerificationStatus.REJECTED;
    }

    if (
      relevantStatuses.some(
        (status) => status === KycVerificationStatus.PENDING_PROVIDER,
      )
    ) {
      return KycVerificationStatus.PENDING_PROVIDER;
    }

    if (
      relevantStatuses.some(
        (status) => status === KycVerificationStatus.SUBMITTED,
      )
    ) {
      return KycVerificationStatus.SUBMITTED;
    }

    return KycVerificationStatus.IN_PROGRESS;
  }

  private derivePayoutStateFromVerificationStatus(
    verificationStatus: KycVerificationStatus,
    accountOwnershipType: AccountOwnershipType,
    livenessStatus?: KycVerificationStatus | null,
  ) {
    if (verificationStatus === KycVerificationStatus.VERIFIED) {
      return {
        kycStatus: KycVerificationStatus.VERIFIED,
        profileStatus: CreatorSettlementProfileStatus.ACTIVE,
        rejectionReason: null,
      };
    }

    if (verificationStatus === KycVerificationStatus.REJECTED) {
      return {
        kycStatus: KycVerificationStatus.REJECTED,
        profileStatus: CreatorSettlementProfileStatus.REVIEW_REQUIRED,
        rejectionReason:
          livenessStatus === KycVerificationStatus.REJECTED
            ? 'Face verification failed. Review submitted details and retry.'
            : accountOwnershipType === AccountOwnershipType.BUSINESS
              ? 'Business verification failed. Review submitted details and retry.'
              : 'Identity verification failed. Review submitted details and retry.',
      };
    }

    if (verificationStatus === KycVerificationStatus.PENDING_PROVIDER) {
      return {
        kycStatus: KycVerificationStatus.PENDING_PROVIDER,
        profileStatus: CreatorSettlementProfileStatus.PENDING_KYC,
        rejectionReason:
          livenessStatus === KycVerificationStatus.PENDING_PROVIDER
            ? 'Face verification is pending provider response.'
            : accountOwnershipType === AccountOwnershipType.BUSINESS
              ? 'Business verification is pending provider response.'
              : 'Identity verification is pending provider response.',
      };
    }

    return {
      kycStatus: KycVerificationStatus.IN_PROGRESS,
      profileStatus: CreatorSettlementProfileStatus.PENDING_KYC,
      rejectionReason: null,
    };
  }

  private canAutoApproveKycTier(input: {
    targetTier: KycTierDto.BASIC | KycTierDto.FULL;
    accountOwnershipType: AccountOwnershipType;
    businessStatus?: KycVerificationStatus | null;
    identityStatus?: KycVerificationStatus | null;
    livenessStatus?: KycVerificationStatus | null;
    nameMatchStatus?: NameMatchStatus | null;
    dedupStatus?: KycVerificationStatus | null;
  }) {
    const requiredStatuses =
      input.targetTier === KycTierDto.FULL
        ? input.accountOwnershipType === AccountOwnershipType.BUSINESS
          ? [input.businessStatus, input.identityStatus, input.livenessStatus]
          : [input.identityStatus, input.livenessStatus]
        : input.accountOwnershipType === AccountOwnershipType.BUSINESS
          ? [input.businessStatus]
          : [input.identityStatus];

    return (
      requiredStatuses.every(
        (status) => status === KycVerificationStatus.VERIFIED,
      ) &&
      input.nameMatchStatus === NameMatchStatus.MATCHED &&
      input.dedupStatus !== KycVerificationStatus.SUBMITTED &&
      input.dedupStatus !== KycVerificationStatus.REJECTED
    );
  }

  private getKycManualReviewReason(input: {
    nameMatchStatus?: NameMatchStatus | null;
    nameMatchReason?: string | null;
    duplicateReason?: string | null;
    mismatchReason: string;
    reviewReason: string;
  }) {
    if (input.duplicateReason) {
      return input.duplicateReason;
    }

    if (input.nameMatchStatus === NameMatchStatus.MISMATCH) {
      return input.mismatchReason;
    }

    if (input.nameMatchStatus === NameMatchStatus.REVIEW_REQUIRED) {
      return input.nameMatchReason || input.reviewReason;
    }

    return null;
  }

  private resolveDikriptVerificationState(status?: string | null) {
    const normalized = (status || '').toLowerCase();

    if (normalized === 'verified' || normalized === 'complete') {
      return 'verified';
    }

    if (
      [
        'pending',
        'processing',
        'in_progress',
        'in progress',
        'queued',
        'submitted',
        'accepted',
        'awaiting_provider',
        'retrying',
      ].includes(normalized)
    ) {
      return 'pending';
    }

    if (!normalized) {
      return 'pending';
    }

    return 'failed';
  }

  private summarizeDikriptIdentityResponse(
    response: DikriptNinResponse,
    input: {
      verificationMode: string;
      identityType: string;
    },
  ) {
    const identityRecord = this.extractIdentityRecord(response);

    return {
      provider: 'DIKRIPT',
      requestId: String(response.id),
      verificationMode: input.verificationMode,
      identityType: input.identityType,
      providerStatus: response.status?.status || null,
      matchStatus: this.extractDikriptIdentityMatchStatus(response) || null,
      verifiedName: this.combineNameParts(
        identityRecord?.firstname,
        identityRecord?.middlename,
        identityRecord?.lastname,
      ),
      insight: Array.isArray(response.insight)
        ? response.insight.map((entry) => ({
            serviceCategory: entry.serviceCategory || null,
            insightCount: entry.insightCount || 0,
            timeframeInMonths: entry.timeframeInMonths || null,
          }))
        : [],
    };
  }

  private summarizeDikriptBusinessResponse(response: DikriptCacResponse) {
    return {
      provider: 'DIKRIPT',
      requestId: String(response.id),
      providerStatus: response.status?.status || null,
      cacCheckStatus: response.summary?.cac_check || null,
      companyName: response.cac?.companyName || null,
      companyType: response.cac?.companyType || null,
      rcNumberMasked: this.maskIdentityReference(
        response.cac?.rcNumber || null,
      ),
      registrationDate: response.cac?.registrationDate || null,
      affiliateCount: response.cac?.affiliatesData?.length || 0,
    };
  }

  private summarizeDikriptFaceVerificationResponse(
    response: DikriptFaceVerificationResponse,
  ) {
    return {
      provider: 'DIKRIPT',
      requestId: String(response.id),
      providerStatus: response.status?.status || null,
      match: response.summary?.face_verification_check?.match ?? null,
      matchScore:
        response.summary?.face_verification_check?.match_score ?? null,
      matchingThreshold:
        response.summary?.face_verification_check?.matching_threshold ?? null,
      maxScore: response.summary?.face_verification_check?.max_score ?? null,
    };
  }

  private summarizeDikriptWebhookPayload(payload: any) {
    return {
      event: payload?.event || null,
      eventType: payload?.event_type || null,
      requestId: payload?.data?.id ? String(payload.data.id) : null,
      status:
        payload?.data?.status?.status ||
        payload?.data?.status?.state ||
        payload?.status ||
        null,
      receivedAt: new Date().toISOString(),
    };
  }

  private evaluateSettlementNameMatch(input: {
    accountOwnershipType: AccountOwnershipType;
    accountName?: string | null;
    verifiedFullName?: string | null;
    verifiedBusinessName?: string | null;
  }) {
    const sourceName =
      input.accountOwnershipType === AccountOwnershipType.BUSINESS
        ? input.verifiedBusinessName
        : input.verifiedFullName;

    if (!input.accountName || !sourceName) {
      return {
        status: NameMatchStatus.NOT_CHECKED,
        score: 0,
        reason: 'Missing account name or verified identity name',
      };
    }

    const accountTokens = this.normalizeNameTokens(input.accountName);
    const sourceTokens = this.normalizeNameTokens(sourceName);

    if (accountTokens.length === 0 || sourceTokens.length === 0) {
      return {
        status: NameMatchStatus.NOT_CHECKED,
        score: 0,
        reason: 'Name normalization removed all tokens',
      };
    }

    const sharedTokens = accountTokens.filter((token) =>
      sourceTokens.includes(token),
    );
    const uniqueTokenCount = new Set([...accountTokens, ...sourceTokens]).size;
    const score =
      uniqueTokenCount > 0 ? sharedTokens.length / uniqueTokenCount : 0;

    const isFirstLastMatch =
      accountTokens[0] === sourceTokens[0] &&
      accountTokens[accountTokens.length - 1] ===
        sourceTokens[sourceTokens.length - 1];
    const isTransposedMatch =
      accountTokens[0] === sourceTokens[sourceTokens.length - 1] &&
      accountTokens[accountTokens.length - 1] === sourceTokens[0];

    if (isFirstLastMatch || isTransposedMatch || score >= 0.8) {
      return {
        status: NameMatchStatus.MATCHED,
        score,
        reason: 'Verified identity name matched settlement account name',
      };
    }

    if (score >= 0.45) {
      return {
        status: NameMatchStatus.REVIEW_REQUIRED,
        score,
        reason: 'Settlement account name partially matches verified identity',
      };
    }

    return {
      status: NameMatchStatus.MISMATCH,
      score,
      reason: 'Settlement account name does not match verified identity',
    };
  }

  private evaluateBusinessRepresentativeDirectorMatch(input: {
    representativeName?: string | null;
    businessResponse: DikriptCacResponse;
  }) {
    if (!input.representativeName) {
      return {
        status: NameMatchStatus.NOT_CHECKED,
        score: 0,
        reason: 'Missing verified representative name',
        matchedName: null,
        matchedRole: null,
      };
    }

    const representativeTokens = this.normalizeNameTokens(
      input.representativeName,
    );

    if (representativeTokens.length === 0) {
      return {
        status: NameMatchStatus.NOT_CHECKED,
        score: 0,
        reason: 'Representative name could not be normalized',
        matchedName: null,
        matchedRole: null,
      };
    }

    const affiliates =
      input.businessResponse.cac?.affiliatesData
        ?.map((affiliate) => {
          const role = affiliate.affiliateType?.name || null;
          const name = this.combineNameParts(
            affiliate.firstname,
            affiliate.othername,
            affiliate.surname,
          );

          return {
            name,
            role,
            status: affiliate.status || null,
          };
        })
        .filter((affiliate) => {
          if (!affiliate.name) {
            return false;
          }

          const normalizedRole = (affiliate.role || '').toUpperCase();

          return (
            affiliate.status !== 'INACTIVE' &&
            normalizedRole !== 'PRESENTER' &&
            normalizedRole !== 'SECRETARY_COMPANY'
          );
        }) || [];

    if (!affiliates.length) {
      return {
        status: NameMatchStatus.REVIEW_REQUIRED,
        score: 0,
        reason:
          'CAC advanced check did not return director or controller names for automatic matching',
        matchedName: null,
        matchedRole: null,
      };
    }

    const bestMatch = affiliates
      .map((affiliate) => {
        const affiliateTokens = this.normalizeNameTokens(affiliate.name || '');
        const sharedTokens = representativeTokens.filter((token) =>
          affiliateTokens.includes(token),
        );
        const uniqueTokenCount = new Set([
          ...representativeTokens,
          ...affiliateTokens,
        ]).size;
        const score =
          uniqueTokenCount > 0 ? sharedTokens.length / uniqueTokenCount : 0;
        const firstLastMatch =
          representativeTokens[0] === affiliateTokens[0] &&
          representativeTokens[representativeTokens.length - 1] ===
            affiliateTokens[affiliateTokens.length - 1];
        const transposedMatch =
          representativeTokens[0] ===
            affiliateTokens[affiliateTokens.length - 1] &&
          representativeTokens[representativeTokens.length - 1] ===
            affiliateTokens[0];

        return {
          ...affiliate,
          score,
          strongMatch: firstLastMatch || transposedMatch || score >= 0.75,
        };
      })
      .sort((a, b) => b.score - a.score)[0];

    if (bestMatch?.strongMatch) {
      return {
        status: NameMatchStatus.MATCHED,
        score: bestMatch.score,
        reason: 'Representative matched CAC director or controller details',
        matchedName: bestMatch.name,
        matchedRole: bestMatch.role,
      };
    }

    if (bestMatch && bestMatch.score >= 0.45) {
      return {
        status: NameMatchStatus.REVIEW_REQUIRED,
        score: bestMatch.score,
        reason:
          'Representative partially matches CAC director or controller details',
        matchedName: bestMatch.name,
        matchedRole: bestMatch.role,
      };
    }

    return {
      status: NameMatchStatus.MISMATCH,
      score: bestMatch?.score || 0,
      reason:
        'Representative does not match CAC director or controller details',
      matchedName: bestMatch?.name || null,
      matchedRole: bestMatch?.role || null,
    };
  }

  private resolveStoredBusinessRegNumber(
    metadata: Prisma.JsonValue | null | undefined,
  ) {
    const businessDraft = this.normalizeJsonObject(
      this.normalizeJsonObject(metadata).businessDraft,
    );
    const regNumber =
      typeof businessDraft.regNumber === 'string'
        ? businessDraft.regNumber.trim()
        : null;

    if (!regNumber || regNumber.includes('*')) {
      return null;
    }

    return regNumber;
  }

  private normalizeNameTokens(value: string) {
    return value
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\b(MR|MRS|MISS|DR|CHIEF|PRINCE|PRINCESS|ENGR|ENG)\b/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  private deriveKycStatusFromPayoutProfile(
    payoutProfile?: {
      status?: CreatorSettlementProfileStatus | null;
    } | null,
  ) {
    switch (payoutProfile?.status) {
      case CreatorSettlementProfileStatus.ACTIVE:
        return KycVerificationStatus.VERIFIED;
      case CreatorSettlementProfileStatus.REJECTED:
        return KycVerificationStatus.REJECTED;
      case CreatorSettlementProfileStatus.PENDING_KYC:
      case CreatorSettlementProfileStatus.REVIEW_REQUIRED:
        return KycVerificationStatus.IN_PROGRESS;
      default:
        return KycVerificationStatus.NOT_STARTED;
    }
  }

  private async getKycMetadata(userId: string) {
    const existingVerification =
      await this.prisma.creatorKycVerification.findUnique({
        where: { userId },
        select: { metadata: true },
      });

    return existingVerification &&
      existingVerification.metadata &&
      typeof existingVerification.metadata === 'object' &&
      !Array.isArray(existingVerification.metadata)
      ? { ...(existingVerification.metadata as Record<string, any>) }
      : {};
  }

  private getKycResolutionTargetState(
    verification: {
      businessStatus?: KycVerificationStatus | null;
      identityStatus?: KycVerificationStatus | null;
      livenessStatus?: KycVerificationStatus | null;
      qoreBusinessCheckId?: string | null;
      qoreIdentityCheckId?: string | null;
      qoreLivenessCheckId?: string | null;
    },
    target: KycResolutionNotificationTargetDto,
  ) {
    switch (target) {
      case KycResolutionNotificationTargetDto.BUSINESS:
        return {
          status:
            verification.businessStatus || KycVerificationStatus.NOT_STARTED,
          requestId: verification.qoreBusinessCheckId || null,
        };
      case KycResolutionNotificationTargetDto.LIVENESS:
        return {
          status:
            verification.livenessStatus || KycVerificationStatus.NOT_STARTED,
          requestId: verification.qoreLivenessCheckId || null,
        };
      case KycResolutionNotificationTargetDto.IDENTITY:
      default:
        return {
          status:
            verification.identityStatus || KycVerificationStatus.NOT_STARTED,
          requestId: verification.qoreIdentityCheckId || null,
        };
    }
  }

  private async sendQueuedKycResolutionNotification(
    verification: {
      id: string;
      userId: string;
      accountOwnershipType: AccountOwnershipType;
      metadata?: Prisma.JsonValue | null;
    },
    target: KycResolutionNotificationTargetDto,
    requestId: string,
    resolvedStatus: KycVerificationStatus,
    options?: { force?: boolean },
  ) {
    const metadata =
      verification.metadata &&
      typeof verification.metadata === 'object' &&
      !Array.isArray(verification.metadata)
        ? { ...(verification.metadata as Record<string, any>) }
        : {};
    const resolutionNotification =
      metadata.resolutionNotification &&
      typeof metadata.resolutionNotification === 'object' &&
      !Array.isArray(metadata.resolutionNotification)
        ? { ...(metadata.resolutionNotification as Record<string, any>) }
        : null;

    const matchesExistingSubscription =
      resolutionNotification?.target === target &&
      resolutionNotification?.requestId === requestId;
    const alreadySent =
      matchesExistingSubscription && Boolean(resolutionNotification?.sentAt);

    if (!options?.force && !matchesExistingSubscription) {
      return false;
    }

    if (alreadySent) {
      return false;
    }

    const notificationContent = this.buildKycResolutionNotificationContent(
      target,
      resolvedStatus,
      verification.accountOwnershipType,
    );

    await this.notificationService.createNotification({
      recipientIds: [verification.userId],
      type: notificationConstants.KYC_VERIFICATION_UPDATE,
      title: notificationConstants.KYC_VERIFICATION_UPDATE_TITLE,
      message: notificationContent.message,
      link: '/wallet',
      data: {
        target,
        resolvedStatus,
      },
    });

    await this.prisma.creatorKycVerification.update({
      where: { id: verification.id },
      data: {
        metadata: {
          ...metadata,
          resolutionNotification: {
            target,
            requestId,
            requestedAt:
              resolutionNotification?.requestedAt || new Date().toISOString(),
            sentAt: new Date().toISOString(),
            resolvedStatus,
          },
        },
      },
    });

    return true;
  }

  private buildKycResolutionNotificationContent(
    target: KycResolutionNotificationTargetDto,
    resolvedStatus: KycVerificationStatus,
    ownershipType: AccountOwnershipType,
  ) {
    if (resolvedStatus === KycVerificationStatus.VERIFIED) {
      switch (target) {
        case KycResolutionNotificationTargetDto.BUSINESS:
          return {
            message:
              'Your business verification is complete. Return to wallet to continue with the representative.',
          };
        case KycResolutionNotificationTargetDto.LIVENESS:
          return {
            message:
              'Your face verification is complete. Return to wallet to submit your KYC for review.',
          };
        case KycResolutionNotificationTargetDto.IDENTITY:
        default:
          return {
            message:
              ownershipType === AccountOwnershipType.BUSINESS
                ? 'Your representative identity verification is complete. Face match is ready in wallet.'
                : 'Your identity verification is complete. Face match is ready in wallet.',
          };
      }
    }

    switch (target) {
      case KycResolutionNotificationTargetDto.BUSINESS:
        return {
          message:
            'Your business verification needs attention. Review the submitted details in wallet and try again.',
        };
      case KycResolutionNotificationTargetDto.LIVENESS:
        return {
          message:
            'Your face verification did not pass. Review the instructions in wallet and submit a new selfie.',
        };
      case KycResolutionNotificationTargetDto.IDENTITY:
      default:
        return {
          message:
            ownershipType === AccountOwnershipType.BUSINESS
              ? 'Your representative identity verification needs attention. Review the submitted details in wallet and try again.'
              : 'Your identity verification needs attention. Review the submitted details in wallet and try again.',
        };
    }
  }

  private async getKycMetadataSection(userId: string, key: string) {
    const metadata = await this.getKycMetadata(userId);
    const value = metadata[key];

    return value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, any>) }
      : {};
  }

  private generateSettlementReference() {
    return `SET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  private buildAlatDisplayName(accountName?: string | null) {
    if (!accountName) {
      return null;
    }

    return `GatherGo - ${accountName}`;
  }

  private buildInternalAlatQueueWhere(
    dto: InternalAlatQueueQueryDto,
  ): Prisma.UserWhereInput {
    const needsAction = dto.needsAction ?? true;
    const whereClause: Prisma.UserWhereInput = {
      ...(dto.userId ? { id: dto.userId } : {}),
      settlementProfile: dto.profileStatus
        ? {
            is: {
              status:
                dto.profileStatus as unknown as CreatorSettlementProfileStatus,
            },
          }
        : needsAction
          ? {
              is: {
                status: CreatorSettlementProfileStatus.ACTIVE,
              },
            }
          : {
              isNot: null,
            },
    };

    if (dto.alatStatus) {
      whereClause.alatProfile = {
        is: {
          status: dto.alatStatus as unknown as CreatorAlatProfileStatus,
        },
      };
    } else if (needsAction) {
      whereClause.OR = [
        {
          alatProfile: {
            is: null,
          },
        },
        {
          alatProfile: {
            is: {
              status: {
                not: CreatorAlatProfileStatus.ACTIVE,
              },
            },
          },
        },
      ];
    }

    return whereClause;
  }
}

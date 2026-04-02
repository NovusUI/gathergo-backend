import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import {
  AccountOwnershipType,
  CreatorAlatProfileStatus,
  CreatorSettlementProfileStatus,
  KycVerificationStatus,
  NameMatchStatus,
  PaymentType,
  Prisma,
  RiskStatus,
  SettlementRecordStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { calculatePlatformFeeKobo } from 'src/modules/transaction-reference/payment-pricing.util';
import {
  AccountChangesQueryDto,
  CompleteSettlementDto,
  CreateSettlementDto,
  CreatorPayoutProfileStatusDto,
  InternalAlatQueueQueryDto,
  InternalKycQueueQueryDto,
  KycResolutionNotificationTargetDto,
  NotifyOnKycResolutionDto,
  PersonalLivenessDto,
  ReviewKycDto,
  ReviewPayoutProfileDto,
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
  QoreIdCacResponse,
  QoreIdFaceVerificationResponse,
  QoreIdNinResponse,
  QoreIdNubanResponse,
  QoreIdService,
} from './qoreid.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qoreIdService: QoreIdService,
    private readonly notificationService: NotificationService,
  ) {}

  async getWalletOverview(userId: string) {
    await this.backfillCreatorTransactions(userId);

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
        include: {
          event: {
            select: { title: true },
          },
          user: {
            select: { username: true, fullName: true },
          },
        },
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
        const grossAmountKobo = this.resolveGrossAmountKobo(transaction);
        const creatorPayableKobo = this.resolveCreatorPayableKobo(transaction);

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
    const canOfferAlatTransfer =
      canReceiveSettlement &&
      alatStatus === CreatorAlatProfileStatus.ACTIVE &&
      Boolean(alatProfile?.businessId);

    const tasks = this.buildOnboardingTasks(
      payoutStatus,
      kycStatus,
      alatStatus,
      Boolean(alatProfile?.businessId),
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

    return this.formatKyc(
      kycVerification || {
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
      },
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
    const banks = await this.qoreIdService.getNubanBanks();

    return {
      data: Array.isArray(banks)
        ? banks.map((bank) => ({
            name: bank.name || null,
            code: bank.code || null,
            longcode: bank.longcode || null,
          }))
        : [],
    };
  }

  async getInternalKycQueue(dto: InternalKycQueueQueryDto, opsKey?: string) {
    this.assertOpsKey(opsKey);

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
        orderBy: [{ reviewedAt: 'asc' }, { submittedAt: 'asc' }, { updatedAt: 'desc' }],
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

  async getInternalAlatQueue(dto: InternalAlatQueueQueryDto, opsKey?: string) {
    this.assertOpsKey(opsKey);

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
      data: creators.map((creator) => this.formatInternalAlatQueueItem(creator)),
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

  async handleQoreIdWebhook(payload: any, signature: string, rawBody?: Buffer) {
    const isValid = this.qoreIdService.verifyWebhookSignature(
      payload || {},
      rawBody,
      signature,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid QoreID webhook signature');
    }

    const requestId = payload?.data?.id;
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
        lastWebhook: this.summarizeQoreWebhookPayload(payload),
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
        this.extractIdentityRecord(payload?.data as QoreIdNinResponse)
      ) {
        const identityResponse = payload.data as QoreIdNinResponse;
        const identityRecord = this.extractIdentityRecord(identityResponse);
        const identityStatus =
          this.resolveQoreIdIdentityStatus(identityResponse);
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
        updateData.rejectionReason =
          identityStatus === KycVerificationStatus.REJECTED
            ? 'QoreID webhook reported failed identity verification'
            : null;

        payoutUpdate.kycStatus = nextPayoutState.kycStatus;
        payoutUpdate.status = nextPayoutState.profileStatus;
        payoutUpdate.rejectionReason = nextPayoutState.rejectionReason;
        resolvedNotificationTarget =
          KycResolutionNotificationTargetDto.IDENTITY;
        resolvedNotificationStatus = identityStatus;
      } else if (payload?.data?.cac && isBusinessRequest) {
        const businessResponse = payload.data as QoreIdCacResponse;
        const businessStatus =
          this.resolveQoreIdBusinessStatus(businessResponse);
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

        updateData.businessStatus = businessStatus;
        updateData.status = nextWorkflowStatus;
        updateData.businessReferenceHash = this.hashKycSubject(businessReference);
        updateData.businessReferenceLast4 = this.getLast4(businessReference);
        updateData.dedupStatus = duplicateReview.status;
        updateData.verifiedBusinessName =
          businessResponse.cac?.companyName ||
          verification.verifiedBusinessName;
        updateData.metadata = {
          ...((updateData.metadata as Record<string, any>) || {}),
          dedupReview: duplicateReview.metadata,
        };
        updateData.rejectionReason =
          businessStatus === KycVerificationStatus.REJECTED
            ? 'QoreID webhook reported failed business verification'
            : null;

        payoutUpdate.kycStatus = nextPayoutState.kycStatus;
        payoutUpdate.status = nextPayoutState.profileStatus;
        payoutUpdate.rejectionReason = nextPayoutState.rejectionReason;
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
        payload.data as QoreIdFaceVerificationResponse;
      const livenessStatus = this.resolveQoreIdFaceVerificationStatus(
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

      updateData.livenessStatus = livenessStatus;
      updateData.status = nextWorkflowStatus;
      updateData.rejectionReason =
        livenessStatus === KycVerificationStatus.REJECTED
          ? 'QoreID webhook reported failed face verification'
          : null;

      payoutUpdate.kycStatus = nextPayoutState.kycStatus;
      payoutUpdate.status = nextPayoutState.profileStatus;
      payoutUpdate.rejectionReason = nextPayoutState.rejectionReason;
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
    const [existingProfile, user] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          fullName: true,
          phoneNumber: true,
        },
      }),
    ]);

    if (!normalizedBankCode) {
      throw new BadRequestException('Bank code is required');
    }

    if (!normalizedAccountNumber) {
      throw new BadRequestException('Account number is required');
    }

    await this.assertNoDuplicatePayoutAccount(
      userId,
      normalizedBankCode,
      normalizedAccountNumber,
    );

    const ownershipType = dto.accountOwnershipType as AccountOwnershipType;
    const accountVerification = await this.verifyPayoutAccount(
      ownershipType,
      {
        ...dto,
        bankCode: normalizedBankCode,
        accountNumber: normalizedAccountNumber,
      },
      user?.phoneNumber || null,
    );
    const resolvedAccountName =
      accountVerification?.nuban?.accountName || dto.accountName || null;
    const resolvedStatus = accountVerification
      ? CreatorSettlementProfileStatus.ACCOUNT_VERIFIED
      : CreatorSettlementProfileStatus.ACCOUNT_PROVIDED;

    const criticalFieldsChanged =
      !!existingProfile &&
      (existingProfile.accountNumber !== normalizedAccountNumber ||
        existingProfile.bankName !== dto.bankName ||
        existingProfile.bankCode !== normalizedBankCode ||
        existingProfile.accountName !== resolvedAccountName ||
        existingProfile.accountOwnershipType !== ownershipType);

    const nextStatus =
      existingProfile?.status === CreatorSettlementProfileStatus.ACTIVE &&
      !criticalFieldsChanged
        ? CreatorSettlementProfileStatus.ACTIVE
        : resolvedStatus;

    const nextKycStatus =
      criticalFieldsChanged || !existingProfile?.kycStatus
        ? KycVerificationStatus.NOT_STARTED
        : existingProfile.kycStatus;

    const nextNameMatchStatus = criticalFieldsChanged
      ? NameMatchStatus.NOT_CHECKED
      : existingProfile?.nameMatchStatus || NameMatchStatus.NOT_CHECKED;

    const profile = await this.prisma.creatorSettlementProfile.upsert({
      where: { userId },
      update: {
        businessName: dto.businessName,
        legalName: dto.legalName,
        accountOwnershipType: ownershipType,
        bankName: dto.bankName,
        bankCode: normalizedBankCode,
        accountName: resolvedAccountName,
        accountNumber: normalizedAccountNumber,
        accountNumberMasked: this.maskAccountNumber(normalizedAccountNumber),
        bvnLast4: dto.bvnLast4,
        accountVerifiedAt: accountVerification ? new Date() : null,
        kycStatus: nextKycStatus,
        nameMatchStatus: nextNameMatchStatus,
        status: nextStatus,
        metadata: {
          ...(existingProfile?.metadata &&
          typeof existingProfile.metadata === 'object' &&
          !Array.isArray(existingProfile.metadata)
            ? (existingProfile.metadata as Record<string, any>)
            : {}),
          qoreId: accountVerification
            ? this.summarizeQoreNubanResponse(
                accountVerification,
                ownershipType,
              )
            : null,
        },
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
        businessName: dto.businessName,
        legalName: dto.legalName,
        accountOwnershipType: ownershipType,
        bankName: dto.bankName,
        bankCode: normalizedBankCode,
        accountName: resolvedAccountName,
        accountNumber: normalizedAccountNumber,
        accountNumberMasked: this.maskAccountNumber(normalizedAccountNumber),
        bvnLast4: dto.bvnLast4,
        accountVerifiedAt: accountVerification ? new Date() : null,
        kycStatus: KycVerificationStatus.NOT_STARTED,
        nameMatchStatus: NameMatchStatus.NOT_CHECKED,
        status: resolvedStatus,
        submittedAt: new Date(),
        metadata: {
          qoreId: accountVerification
            ? this.summarizeQoreNubanResponse(
                accountVerification,
                ownershipType,
              )
            : null,
        },
      },
    });

    await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        accountOwnershipType: ownershipType,
        verificationMode:
          criticalFieldsChanged && existingProfile ? null : undefined,
        businessStatus:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        identityStatus:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        livenessStatus:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        amlStatus:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        dedupStatus:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        status:
          criticalFieldsChanged && existingProfile
            ? KycVerificationStatus.NOT_STARTED
            : undefined,
        nameMatchStatus:
          criticalFieldsChanged && existingProfile
            ? NameMatchStatus.NOT_CHECKED
            : undefined,
        identityType:
          criticalFieldsChanged && existingProfile ? null : undefined,
        identityReferenceMasked:
          criticalFieldsChanged && existingProfile ? null : undefined,
        identityReferenceLast4:
          criticalFieldsChanged && existingProfile ? null : undefined,
        providerSubjectHash:
          criticalFieldsChanged && existingProfile ? null : undefined,
        providerSubjectLast4:
          criticalFieldsChanged && existingProfile ? null : undefined,
        businessReferenceHash:
          criticalFieldsChanged && existingProfile ? null : undefined,
        businessReferenceLast4:
          criticalFieldsChanged && existingProfile ? null : undefined,
        nameDobHash: criticalFieldsChanged && existingProfile ? null : undefined,
        verifiedFullName:
          criticalFieldsChanged && existingProfile ? null : undefined,
        verifiedBusinessName:
          criticalFieldsChanged && existingProfile ? null : undefined,
        verifiedDateOfBirth:
          criticalFieldsChanged && existingProfile ? null : undefined,
        qoreBusinessCheckId:
          criticalFieldsChanged && existingProfile ? null : undefined,
        qoreIdentityCheckId:
          criticalFieldsChanged && existingProfile ? null : undefined,
        qoreLivenessCheckId:
          criticalFieldsChanged && existingProfile ? null : undefined,
      },
      create: {
        userId,
        settlementProfileId: profile.id,
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
          newBankCode: normalizedBankCode,
          newAccountNumberMasked: this.maskAccountNumber(normalizedAccountNumber),
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
          accountNumber: normalizedAccountNumber,
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
          accountNumber: normalizedAccountNumber,
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

  async reviewPayoutProfile(
    targetUserId: string,
    dto: ReviewPayoutProfileDto,
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);

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
    const [payoutProfile, user] = await Promise.all([
      this.prisma.creatorSettlementProfile.findUnique({
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
    const identityResponse = await this.verifyPersonalIdentityWithQoreId({
      verificationMode,
      dto,
      resolvedNames,
      user,
    });

    if (!identityResponse) {
      throw new BadRequestException(
        'Phone number, NIN, vNIN, or passport number is required for personal KYC',
      );
    }

    const identityStatus = this.resolveQoreIdIdentityStatus(identityResponse);
    const payoutState = this.derivePayoutStateFromVerificationStatus(
      identityStatus === KycVerificationStatus.VERIFIED
        ? KycVerificationStatus.IN_PROGRESS
        : identityStatus,
      AccountOwnershipType.PERSONAL,
    );
    const identityRecord = this.extractIdentityRecord(identityResponse);
    const identityType = this.resolveIdentityTypeFromMode(verificationMode);
    const verifiedFullName = this.combineNameParts(
      identityRecord?.firstname,
      identityRecord?.middlename,
      identityRecord?.lastname,
    );
    const verifiedDateOfBirth = this.parseDate(
      identityRecord?.birthdate || dto.dateOfBirth || null,
    );
    const identityReference = this.resolveIdentityReferenceFromMode(
      verificationMode,
      dto,
    );
    const providerSubject = this.extractProviderSubject(identityResponse);
    const duplicateReview = await this.detectDuplicateKycSignals({
      userId,
      providerSubjectHash: this.hashKycSubject(providerSubject),
      nameDobHash: this.hashNameDob(verifiedFullName, verifiedDateOfBirth),
    });

    const verification = await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        accountOwnershipType: AccountOwnershipType.PERSONAL,
        verificationMode,
        phoneNumber: dto.phoneNumber || user?.phoneNumber || undefined,
        identityType,
        identityReferenceMasked: this.maskIdentityReference(identityReference),
        identityReferenceLast4: this.getLast4(identityReference),
        providerSubjectHash: this.hashKycSubject(providerSubject),
        providerSubjectLast4: this.getLast4(providerSubject),
        businessReferenceHash: null,
        businessReferenceLast4: null,
        businessStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        qoreLivenessCheckId: null,
        dedupStatus: duplicateReview.status,
        nameMatchStatus: NameMatchStatus.NOT_CHECKED,
        status:
          identityStatus === KycVerificationStatus.PENDING_PROVIDER
            ? KycVerificationStatus.PENDING_PROVIDER
            : KycVerificationStatus.IN_PROGRESS,
        identityStatus,
        verifiedFullName,
        verifiedDateOfBirth,
        nameDobHash: this.hashNameDob(verifiedFullName, verifiedDateOfBirth),
        qoreIdentityCheckId: String(identityResponse.id),
        rejectionReason:
          identityStatus === KycVerificationStatus.REJECTED
            ? 'QoreID could not verify the submitted personal identity details'
            : null,
        metadata: {
          ...(await this.getKycMetadata(userId)),
          personalDraft: {
            firstName: resolvedNames.firstName,
            lastName: resolvedNames.lastName,
            dateOfBirth: dto.dateOfBirth || null,
          },
          dedupReview: duplicateReview.metadata,
          qoreIdIdentity: this.summarizeQoreNinResponse(identityResponse, {
            verificationMode,
            identityType,
          }),
        },
      },
      create: {
        userId,
        settlementProfileId: payoutProfile.id,
        accountOwnershipType: AccountOwnershipType.PERSONAL,
        verificationMode,
        phoneNumber: dto.phoneNumber || user?.phoneNumber || null,
        identityType,
        identityReferenceMasked: this.maskIdentityReference(identityReference),
        identityReferenceLast4: this.getLast4(identityReference),
        providerSubjectHash: this.hashKycSubject(providerSubject),
        providerSubjectLast4: this.getLast4(providerSubject),
        businessReferenceHash: null,
        businessReferenceLast4: null,
        businessStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        dedupStatus: duplicateReview.status,
        nameMatchStatus: NameMatchStatus.NOT_CHECKED,
        status:
          identityStatus === KycVerificationStatus.PENDING_PROVIDER
            ? KycVerificationStatus.PENDING_PROVIDER
            : KycVerificationStatus.IN_PROGRESS,
        identityStatus,
        verifiedFullName,
        verifiedDateOfBirth,
        nameDobHash: this.hashNameDob(verifiedFullName, verifiedDateOfBirth),
        qoreIdentityCheckId: String(identityResponse.id),
        rejectionReason:
          identityStatus === KycVerificationStatus.REJECTED
            ? 'QoreID could not verify the submitted personal identity details'
            : null,
        metadata: {
          personalDraft: {
            firstName: resolvedNames.firstName,
            lastName: resolvedNames.lastName,
            dateOfBirth: dto.dateOfBirth || null,
          },
          dedupReview: duplicateReview.metadata,
          qoreIdIdentity: this.summarizeQoreNinResponse(identityResponse, {
            verificationMode,
            identityType,
          }),
        },
      },
    });

    await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        accountOwnershipType: AccountOwnershipType.PERSONAL,
        kycStatus: payoutState.kycStatus,
        status: payoutState.profileStatus,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: payoutState.rejectionReason,
      },
    });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(verification);
  }

  async submitPersonalLiveness(userId: string, dto: PersonalLivenessDto) {
    const existingVerification =
      await this.prisma.creatorKycVerification.findUnique({
        where: { userId },
      });

    if (!existingVerification) {
      throw new NotFoundException('KYC profile not found');
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
      existingVerification.identityStatus !== KycVerificationStatus.VERIFIED
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

    if (!dto.identityNumber) {
      throw new BadRequestException(
        'Identity number is required for face verification',
      );
    }

    if (!dto.imageUrl && !dto.photoBase64) {
      throw new BadRequestException(
        'A selfie photo URL or base64 image is required for face verification',
      );
    }

    const faceVerificationResponse = await this.qoreIdService.verifyFaceMatch({
      idType: this.resolveFaceVerificationIdType(
        existingVerification.verificationMode,
      ),
      idNumber: dto.identityNumber,
      photoUrl: dto.imageUrl || null,
      photoBase64: dto.photoBase64 || null,
    });
    const livenessStatus = this.resolveQoreIdFaceVerificationStatus(
      faceVerificationResponse,
    );
    const workflowStatus = this.deriveVerificationWorkflowStatus({
      accountOwnershipType: existingVerification.accountOwnershipType,
      businessStatus: existingVerification.businessStatus,
      identityStatus: existingVerification.identityStatus,
      livenessStatus,
    });
    const payoutState = this.derivePayoutStateFromVerificationStatus(
      workflowStatus,
      existingVerification.accountOwnershipType,
      livenessStatus,
    );

    const verification = await this.prisma.creatorKycVerification.update({
      where: { userId },
      data: {
        status: workflowStatus,
        livenessStatus,
        qoreLivenessCheckId: String(faceVerificationResponse.id),
        metadata: {
          ...(await this.getKycMetadata(userId)),
          liveness: {
            imageUrl: dto.imageUrl || null,
            submittedAt: new Date().toISOString(),
            faceVerification: this.summarizeQoreFaceVerificationResponse(
              faceVerificationResponse,
            ),
          },
        },
      },
    });

    await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        kycStatus: payoutState.kycStatus,
        status: payoutState.profileStatus,
        rejectionReason: payoutState.rejectionReason,
        approvedAt: null,
        rejectedAt:
          payoutState.profileStatus ===
            CreatorSettlementProfileStatus.REVIEW_REQUIRED &&
          payoutState.kycStatus === KycVerificationStatus.REJECTED
            ? new Date()
            : null,
      },
    });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(verification);
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

    const businessResponse = await this.qoreIdService.verifyCacBasic({
      regNumber: dto.regNumber,
    });
    const businessStatus = this.resolveQoreIdBusinessStatus(businessResponse);
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
    const payoutState = this.derivePayoutStateFromVerificationStatus(
      workflowStatus,
      AccountOwnershipType.BUSINESS,
      existingVerification?.livenessStatus || KycVerificationStatus.NOT_STARTED,
    );
    const businessReference =
      businessResponse.cac?.rcNumber || dto.regNumber || null;
    const duplicateReview = await this.detectDuplicateKycSignals({
      userId,
      businessReferenceHash: this.hashKycSubject(businessReference),
      providerSubjectHash: existingVerification?.providerSubjectHash || null,
    });

    const verification = await this.prisma.creatorKycVerification.upsert({
      where: { userId },
      update: {
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        status: workflowStatus,
        businessStatus,
        businessReferenceHash: this.hashKycSubject(businessReference),
        businessReferenceLast4: this.getLast4(businessReference),
        dedupStatus: duplicateReview.status,
        verifiedBusinessName:
          businessResponse.cac?.companyName || dto.businessName || null,
        qoreBusinessCheckId: String(businessResponse.id),
        rejectionReason:
          businessStatus === KycVerificationStatus.REJECTED
            ? 'QoreID could not verify the submitted business details'
            : null,
        metadata: {
          ...(await this.getKycMetadata(userId)),
          businessDraft: {
            regNumber: this.maskIdentityReference(dto.regNumber),
            businessName: dto.businessName || null,
          },
          dedupReview: duplicateReview.metadata,
          qoreIdBusiness: this.summarizeQoreBusinessResponse(businessResponse),
        },
      },
      create: {
        userId,
        settlementProfileId: payoutProfile.id,
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        status: workflowStatus,
        businessStatus,
        businessReferenceHash: this.hashKycSubject(businessReference),
        businessReferenceLast4: this.getLast4(businessReference),
        dedupStatus: duplicateReview.status,
        identityStatus: KycVerificationStatus.NOT_STARTED,
        livenessStatus: KycVerificationStatus.NOT_STARTED,
        verifiedBusinessName:
          businessResponse.cac?.companyName || dto.businessName || null,
        qoreBusinessCheckId: String(businessResponse.id),
        rejectionReason:
          businessStatus === KycVerificationStatus.REJECTED
            ? 'QoreID could not verify the submitted business details'
            : null,
        metadata: {
          businessDraft: {
            regNumber: this.maskIdentityReference(dto.regNumber),
            businessName: dto.businessName || null,
          },
          dedupReview: duplicateReview.metadata,
          qoreIdBusiness: this.summarizeQoreBusinessResponse(businessResponse),
        },
      },
    });

    await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        kycStatus: payoutState.kycStatus,
        status: payoutState.profileStatus,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: payoutState.rejectionReason,
      },
    });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(verification);
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
    const representativeResponse =
      await this.verifyBusinessRepresentativeWithQoreId({
        verificationMode,
        dto,
        representativeNames,
        user,
      });

    if (!representativeResponse) {
      throw new BadRequestException(
        'Representative phone number, NIN, vNIN, or passport number is required for business KYC',
      );
    }

    const identityStatus = this.resolveQoreIdIdentityStatus(
      representativeResponse,
    );
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
    const identityRecord = this.extractIdentityRecord(representativeResponse);
    const verifiedRepresentativeName = this.combineNameParts(
      identityRecord?.firstname,
      identityRecord?.middlename,
      identityRecord?.lastname,
    );
    const verifiedRepresentativeDateOfBirth = this.parseDate(
      identityRecord?.birthdate || dto.representativeDateOfBirth || null,
    );
    const identityType = this.resolveIdentityTypeFromMode(verificationMode);
    const identityReference = this.resolveIdentityReferenceFromMode(
      verificationMode,
      dto,
    );
    const providerSubject = this.extractProviderSubject(representativeResponse);
    const duplicateReview = await this.detectDuplicateKycSignals({
      userId,
      providerSubjectHash: this.hashKycSubject(providerSubject),
      businessReferenceHash: verification.businessReferenceHash || null,
      nameDobHash: this.hashNameDob(
        verifiedRepresentativeName,
        verifiedRepresentativeDateOfBirth,
      ),
    });

    const updatedVerification = await this.prisma.creatorKycVerification.update(
      {
        where: { userId },
        data: {
          accountOwnershipType: AccountOwnershipType.BUSINESS,
          verificationMode,
          phoneNumber:
            dto.representativePhoneNumber || user?.phoneNumber || undefined,
          identityType,
          identityReferenceMasked:
            this.maskIdentityReference(identityReference),
          identityReferenceLast4: this.getLast4(identityReference),
          providerSubjectHash: this.hashKycSubject(providerSubject),
          providerSubjectLast4: this.getLast4(providerSubject),
          status: workflowStatus,
          identityStatus,
          livenessStatus: KycVerificationStatus.NOT_STARTED,
          qoreLivenessCheckId: null,
          dedupStatus: duplicateReview.status,
          nameMatchStatus: NameMatchStatus.NOT_CHECKED,
          verifiedFullName: verifiedRepresentativeName,
          verifiedDateOfBirth: verifiedRepresentativeDateOfBirth,
          nameDobHash: this.hashNameDob(
            verifiedRepresentativeName,
            verifiedRepresentativeDateOfBirth,
          ),
          qoreIdentityCheckId: String(representativeResponse.id),
          rejectionReason:
            identityStatus === KycVerificationStatus.REJECTED
              ? 'QoreID could not verify the submitted representative details'
              : null,
          metadata: {
            ...(await this.getKycMetadata(userId)),
            businessDraft: {
              ...(await this.getKycMetadataSection(userId, 'businessDraft')),
              representativeFirstName: representativeNames.firstName,
              representativeLastName: representativeNames.lastName,
              representativeDateOfBirth: dto.representativeDateOfBirth || null,
            representativePhoneNumber: dto.representativePhoneNumber || null,
            representativeIdentityReference:
              this.maskIdentityReference(identityReference),
          },
          dedupReview: duplicateReview.metadata,
          qoreIdRepresentative: this.summarizeQoreNinResponse(
            representativeResponse,
            {
              verificationMode,
              identityType,
              },
            ),
          },
        },
      },
    );

    await this.prisma.creatorSettlementProfile.update({
      where: { userId },
      data: {
        accountOwnershipType: AccountOwnershipType.BUSINESS,
        kycStatus: payoutState.kycStatus,
        status: payoutState.profileStatus,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason:
          identityStatus === KycVerificationStatus.REJECTED
            ? 'Representative identity verification failed. Review submitted details and retry.'
            : payoutState.rejectionReason,
      },
    });

    await this.syncCreatorSettlementStatus(userId, payoutState.profileStatus);

    return this.formatKyc(updatedVerification);
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

    if (verification.identityStatus !== KycVerificationStatus.VERIFIED) {
      if (
        verification.identityStatus === KycVerificationStatus.PENDING_PROVIDER
      ) {
        throw new BadRequestException(
          'Identity verification is still pending provider response',
        );
      }

      throw new BadRequestException(
        'Identity verification must pass before KYC can be submitted',
      );
    }

    if (
      verification.livenessStatus === KycVerificationStatus.PENDING_PROVIDER
    ) {
      throw new BadRequestException(
        'Face verification is still pending provider response',
      );
    }

    if (verification.livenessStatus === KycVerificationStatus.REJECTED) {
      throw new BadRequestException(
        'Face verification must pass before KYC can be submitted',
      );
    }

    if (verification.livenessStatus === KycVerificationStatus.NOT_STARTED) {
      throw new BadRequestException(
        'Liveness submission is required before KYC can be submitted',
      );
    }

    const nameMatch = this.evaluateSettlementNameMatch({
      accountOwnershipType: payoutProfile.accountOwnershipType,
      accountName: payoutProfile.accountName,
      verifiedFullName: verification.verifiedFullName,
      verifiedBusinessName: verification.verifiedBusinessName,
    });
    const requiresDuplicateReview =
      verification.dedupStatus === KycVerificationStatus.SUBMITTED;
    const duplicateReviewReason = requiresDuplicateReview
      ? 'This verification requires manual review before payouts can be activated.'
      : null;
    const nextPayoutProfileStatus = requiresDuplicateReview
      ? CreatorSettlementProfileStatus.REVIEW_REQUIRED
      : CreatorSettlementProfileStatus.PENDING_KYC;

    const updatedVerification = await this.prisma.creatorKycVerification.update(
      {
        where: { userId },
        data: {
          status: KycVerificationStatus.SUBMITTED,
          submittedAt: new Date(),
          nameMatchStatus: nameMatch.status,
          nameMatchScore: nameMatch.score,
          nameMatchReason: nameMatch.reason,
          rejectionReason: duplicateReviewReason,
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
        rejectionReason:
          duplicateReviewReason ||
          (nameMatch.status === NameMatchStatus.MISMATCH
            ? 'Payout account name does not match verified identity'
            : null),
      },
    });

    await this.syncCreatorSettlementStatus(
      userId,
      nextPayoutProfileStatus,
    );

    return this.formatKyc(updatedVerification);
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

  async reviewKyc(userId: string, dto: ReviewKycDto, opsKey?: string) {
    this.assertOpsKey(opsKey);

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
            nextKycStatus === KycVerificationStatus.VERIFIED
              ? KycVerificationStatus.VERIFIED
              : existingVerification.identityStatus,
          livenessStatus:
            nextKycStatus === KycVerificationStatus.VERIFIED
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
        },
      }),
    ]);

    await this.syncCreatorSettlementStatus(userId, nextPayoutStatus);

    return this.formatKyc(verification);
  }

  async upsertAlatProfile(
    userId: string,
    dto: UpsertAlatProfileDto,
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);

    const payoutProfile = await this.prisma.creatorSettlementProfile.findUnique(
      {
        where: { userId },
        select: {
          accountNumber: true,
          accountName: true,
          status: true,
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
        include: {
          event: {
            select: { title: true },
          },
          user: {
            select: { username: true, fullName: true },
          },
        },
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

  async createSettlement(
    creatorId: string,
    dto: CreateSettlementDto,
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);
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

    if (
      !payoutProfile.bankName ||
      !payoutProfile.accountName ||
      !payoutProfile.accountNumber
    ) {
      throw new BadRequestException('Creator payout destination is incomplete');
    }

    const transactions = await this.prisma.transactionReference.findMany({
      where: {
        creatorId,
        status: TransactionStatusType.SUCCESS,
        settlementStatus: SettlementStatus.READY,
        creatorPayable: { gt: 0 },
        ...(dto.transactionIds?.length
          ? { id: { in: dto.transactionIds } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (transactions.length === 0) {
      throw new BadRequestException('No transactions are ready for settlement');
    }

    const totalAmount = transactions.reduce(
      (sum, transaction) => sum + this.resolveCreatorPayableKobo(transaction),
      0,
    );
    const reference = this.generateSettlementReference();

    const settlement = await this.prisma.$transaction(async (tx) => {
      const settlementRecord = await tx.settlementRecord.create({
        data: {
          creatorId,
          amount: totalAmount,
          reference,
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
          amount: this.resolveCreatorPayableKobo(transaction),
        })),
      });

      await tx.transactionReference.updateMany({
        where: {
          id: { in: transactions.map((transaction) => transaction.id) },
        },
        data: { settlementStatus: SettlementStatus.PROCESSING },
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
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);

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

    const updatedSettlement = await this.prisma.$transaction(async (tx) => {
      const record = await tx.settlementRecord.update({
        where: { id: settlementId },
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
          },
        });
      }

      return record;
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
  ) {
    await this.backfillCreatorTransactions(creatorId);

    if (profileStatus === CreatorSettlementProfileStatus.ACTIVE) {
      await this.prisma.transactionReference.updateMany({
        where: {
          creatorId,
          status: TransactionStatusType.SUCCESS,
          settlementStatus: {
            in: [SettlementStatus.HELD_KYC, SettlementStatus.NOT_READY],
          },
          riskStatus: RiskStatus.CLEAR,
        },
        data: {
          settlementStatus: SettlementStatus.READY,
        },
      });

      await this.prisma.transactionReference.updateMany({
        where: {
          creatorId,
          status: TransactionStatusType.SUCCESS,
          settlementStatus: {
            in: [SettlementStatus.HELD_KYC, SettlementStatus.NOT_READY],
          },
          riskStatus: {
            in: [RiskStatus.REVIEW, RiskStatus.HOLD],
          },
        },
        data: {
          settlementStatus: SettlementStatus.HELD_RISK,
        },
      });

      return;
    }

    await this.prisma.transactionReference.updateMany({
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

  private async backfillCreatorTransactions(creatorId: string) {
    const payoutProfile = await this.prisma.creatorSettlementProfile.findUnique(
      {
        where: { userId: creatorId },
        select: { status: true },
      },
    );

    const transactions = await this.prisma.transactionReference.findMany({
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
      const effectiveAmountKobo = this.resolveGrossAmountKobo(transaction);
      const platformFeeKobo =
        transaction.platformFee > 0
          ? transaction.platformFee
          : this.calculatePlatformFeeKobo(effectiveAmountKobo);
      const creatorPayableKobo =
        transaction.creatorPayable > 0
          ? transaction.creatorPayable
          : Math.max(
              effectiveAmountKobo - platformFeeKobo - transaction.providerFee,
              0,
            );
      const resolvedCreatorId =
        transaction.creatorId || transaction.event?.creatorId || null;
      const paymentType = this.resolvePaymentType(
        transaction.paymentType,
        metadata,
      );
      const shouldBeReady =
        payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE &&
        transaction.riskStatus === RiskStatus.CLEAR;
      const inferredSettlementStatus =
        transaction.status !== TransactionStatusType.SUCCESS
          ? transaction.settlementStatus
          : transaction.settlementStatus === SettlementStatus.NOT_READY ||
              transaction.settlementStatus === SettlementStatus.HELD_KYC
            ? shouldBeReady
              ? SettlementStatus.READY
              : payoutProfile?.status === CreatorSettlementProfileStatus.ACTIVE
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
        await this.prisma.transactionReference.update({
          where: { id: transaction.id },
          data: updates,
        });
      }
    }
  }

  private resolveGrossAmountKobo(transaction: {
    amount: number;
    metadata?: Prisma.JsonValue;
  }) {
    const metadata =
      transaction.metadata &&
      typeof transaction.metadata === 'object' &&
      !Array.isArray(transaction.metadata)
        ? (transaction.metadata as Record<string, any>)
        : {};

    const pricingAmount = Number(metadata?.pricing?.grossAmountKobo || 0);
    if (pricingAmount > 0) {
      return pricingAmount;
    }

    if (metadata.amountUnit === 'KOBO') {
      return transaction.amount;
    }

    return transaction.amount * 100;
  }

  private resolveCreatorPayableKobo(transaction: {
    amount: number;
    creatorPayable: number;
    platformFee: number;
    providerFee: number;
    metadata?: Prisma.JsonValue;
  }) {
    const metadata =
      transaction.metadata &&
      typeof transaction.metadata === 'object' &&
      !Array.isArray(transaction.metadata)
        ? (transaction.metadata as Record<string, any>)
        : {};

    const pricingCreatorPayable = Number(
      metadata?.pricing?.creatorPayableKobo || 0,
    );
    if (pricingCreatorPayable > 0) {
      return pricingCreatorPayable;
    }

    if (transaction.creatorPayable > 0) {
      return transaction.creatorPayable;
    }

    const grossAmountKobo = this.resolveGrossAmountKobo(transaction);
    const platformFeeKobo =
      transaction.platformFee > 0
        ? transaction.platformFee
        : this.calculatePlatformFeeKobo(grossAmountKobo);

    return Math.max(
      grossAmountKobo - platformFeeKobo - transaction.providerFee,
      0,
    );
  }

  private calculatePlatformFeeKobo(grossAmountKobo: number) {
    return calculatePlatformFeeKobo(grossAmountKobo);
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

  private formatPayoutProfile(profile: any) {
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
      kycStatus: profile.kycStatus || KycVerificationStatus.NOT_STARTED,
      nameMatchStatus: profile.nameMatchStatus || NameMatchStatus.NOT_CHECKED,
      accountVerifiedAt: profile.accountVerifiedAt,
      rejectionReason: profile.rejectionReason,
      submittedAt: profile.submittedAt,
      approvedAt: profile.approvedAt,
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
      payoutProfile: payoutProfile ? this.formatPayoutProfile(payoutProfile) : null,
      alatProfile: alatProfile
        ? {
            status: alatProfile.status,
            displayName: alatProfile.displayName,
            businessId: alatProfile.businessId,
            subaccountReference: alatProfile.subaccountReference,
            accountNumberMasked: this.maskAccountNumber(alatProfile.accountNumber),
            accountName: alatProfile.accountName,
            activatedAt: alatProfile.activatedAt,
            reviewedAt: alatProfile.reviewedAt,
            notes: alatProfile.notes,
          }
        : null,
    };
  }

  private formatKyc(verification: any) {
    const steps = this.buildKycSteps(verification);

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
    };
  }

  private formatInternalKycQueueItem(verification: any) {
    const payoutProfile = verification.settlementProfile || null;
    const formattedPayoutProfile = payoutProfile
      ? this.formatPayoutProfile(payoutProfile)
      : null;
    const formattedVerification = this.formatKyc(verification);

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

  private formatTransaction(transaction: any) {
    const grossAmountKobo = this.resolveGrossAmountKobo(transaction);
    const creatorPayableKobo = this.resolveCreatorPayableKobo(transaction);
    const platformFeeKobo =
      transaction.platformFee > 0
        ? transaction.platformFee
        : this.calculatePlatformFeeKobo(grossAmountKobo);

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

  private extractProviderSubject(response?: QoreIdNinResponse | null) {
    const identityRecord = this.extractIdentityRecord(response);
    return identityRecord?.phone || null;
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
  ) {
    const payoutTaskStatus =
      payoutStatus === CreatorSettlementProfileStatus.NOT_STARTED
        ? 'PENDING'
        : 'COMPLETED';
    const kycTaskStatus =
      payoutStatus === CreatorSettlementProfileStatus.NOT_STARTED
        ? 'LOCKED'
        : kycStatus === KycVerificationStatus.VERIFIED
          ? 'COMPLETED'
          : 'PENDING';
    const alatTaskStatus =
      payoutStatus !== CreatorSettlementProfileStatus.ACTIVE
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
        title: 'Complete identity verification',
        status: kycTaskStatus,
        blocking: true,
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
      dto.status || dto.profileStatus || dto.nameMatchStatus,
    );

    return {
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

  private buildKycSteps(verification: any) {
    const accountOwnershipType =
      verification.accountOwnershipType || AccountOwnershipType.UNKNOWN;
    const businessStatus =
      verification.businessStatus || KycVerificationStatus.NOT_STARTED;
    const identityStatus =
      verification.identityStatus || KycVerificationStatus.NOT_STARTED;
    const livenessStatus =
      verification.livenessStatus || KycVerificationStatus.NOT_STARTED;
    const amlStatus =
      verification.amlStatus || KycVerificationStatus.NOT_STARTED;
    const nameMatchStatus =
      verification.nameMatchStatus || NameMatchStatus.NOT_CHECKED;

    if (accountOwnershipType === AccountOwnershipType.BUSINESS) {
      return [
        {
          code: 'BUSINESS_IDENTITY',
          status: this.mapKycStatusToStep(businessStatus),
        },
        {
          code: 'REPRESENTATIVE_IDENTITY',
          status:
            businessStatus !== KycVerificationStatus.VERIFIED
              ? 'LOCKED'
              : this.mapKycStatusToStep(identityStatus),
        },
        {
          code: 'LIVENESS',
          status:
            identityStatus !== KycVerificationStatus.VERIFIED
              ? 'LOCKED'
              : this.mapKycStatusToStep(livenessStatus),
        },
        {
          code: 'AML',
          status:
            livenessStatus === KycVerificationStatus.NOT_STARTED
              ? 'LOCKED'
              : this.mapKycStatusToStep(amlStatus),
        },
        {
          code: 'NAME_MATCH',
          status:
            amlStatus === KycVerificationStatus.NOT_STARTED
              ? 'LOCKED'
              : nameMatchStatus === NameMatchStatus.MATCHED
                ? 'COMPLETED'
                : nameMatchStatus === NameMatchStatus.REVIEW_REQUIRED
                  ? 'REVIEW'
                  : nameMatchStatus === NameMatchStatus.MISMATCH
                    ? 'FAILED'
                    : 'PENDING',
        },
      ];
    }

    return [
      {
        code: 'IDENTITY',
        status: this.mapKycStatusToStep(identityStatus),
      },
      {
        code: 'LIVENESS',
        status:
          identityStatus !== KycVerificationStatus.VERIFIED
            ? 'LOCKED'
            : this.mapKycStatusToStep(livenessStatus),
      },
      {
        code: 'AML',
        status:
          livenessStatus === KycVerificationStatus.NOT_STARTED
            ? 'LOCKED'
            : this.mapKycStatusToStep(amlStatus),
      },
      {
        code: 'NAME_MATCH',
        status:
          amlStatus === KycVerificationStatus.NOT_STARTED
            ? 'LOCKED'
            : nameMatchStatus === NameMatchStatus.MATCHED
              ? 'COMPLETED'
              : nameMatchStatus === NameMatchStatus.REVIEW_REQUIRED
                ? 'REVIEW'
                : nameMatchStatus === NameMatchStatus.MISMATCH
                  ? 'FAILED'
                  : 'PENDING',
      },
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

  private async verifyPayoutAccount(
    ownershipType: AccountOwnershipType,
    dto: UpsertPayoutProfileDto,
    phoneNumber?: string | null,
  ) {
    const referenceName =
      ownershipType === AccountOwnershipType.BUSINESS
        ? dto.businessName || dto.accountName
        : dto.legalName || dto.accountName;

    if (!referenceName) {
      throw new BadRequestException(
        ownershipType === AccountOwnershipType.BUSINESS
          ? 'Business name is required to verify a business payout account'
          : 'Legal name is required to verify a personal payout account',
      );
    }

    const names = this.resolveAccountVerificationNames(
      referenceName,
      ownershipType === AccountOwnershipType.PERSONAL,
    );

    if (!names || !dto.bankCode) {
      throw new BadRequestException(
        ownershipType === AccountOwnershipType.BUSINESS
          ? 'Business name and bank code are required to verify a business payout account'
          : 'Legal name and bank code are required to verify a personal payout account',
      );
    }

    const response = await this.qoreIdService.verifyNuban({
      firstName: names.firstName,
      lastName: names.lastName,
      accountNumber: dto.accountNumber,
      bankCode: dto.bankCode,
      phone: phoneNumber || null,
    });

    const verificationState = this.resolveQoreIdVerificationState(
      response.status?.status,
    );
    const matchStatus = (
      response.summary?.nuban_check?.status || ''
    ).toUpperCase();

    if (verificationState === 'failed' || !response.nuban?.accountName) {
      throw new BadRequestException(
        'We could not verify the submitted payout account',
      );
    }

    if (
      ownershipType === AccountOwnershipType.PERSONAL &&
      matchStatus === 'NO_MATCH'
    ) {
      throw new BadRequestException(
        'We could not verify the submitted payout account',
      );
    }

    return response;
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

  private resolveAccountVerificationNames(
    fallbackFullName?: string | null,
    requireDistinctParts = true,
  ) {
    if (!fallbackFullName) {
      return null;
    }

    const tokens = fallbackFullName.trim().split(/\s+/).filter(Boolean);

    if (tokens.length === 0) {
      return null;
    }

    if (tokens.length === 1) {
      if (requireDistinctParts) {
        return null;
      }

      return {
        firstName: tokens[0],
        lastName: tokens[0],
      };
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

    if (dto.passportNumber) {
      return 'PERSONAL_PASSPORT';
    }

    if (dto.vnin) {
      return 'PERSONAL_VNIN';
    }

    if (dto.nin) {
      return 'PERSONAL_NIN';
    }

    return 'PERSONAL_PHONE_NIN';
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

    if (dto.representativePassportNumber) {
      return 'BUSINESS_CAC_REP_PASSPORT';
    }

    if (dto.representativeVnin) {
      return 'BUSINESS_CAC_REP_VNIN';
    }

    if (dto.representativeNin) {
      return 'BUSINESS_CAC_REP_NIN';
    }

    return 'BUSINESS_CAC_REP_PHONE_NIN';
  }

  private resolveIdentityTypeFromMode(mode: string) {
    if (mode.includes('PASSPORT')) {
      return 'PASSPORT';
    }

    if (mode.includes('VNIN')) {
      return 'VNIN';
    }

    if (mode.includes('PHONE_NIN')) {
      return 'PHONE_NIN';
    }

    return 'NIN';
  }

  private resolveFaceVerificationIdType(mode: string) {
    if (mode.includes('PASSPORT')) {
      return 'nigerian_passport' as const;
    }

    if (mode.includes('VNIN')) {
      return 'vnin' as const;
    }

    return 'nin' as const;
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
      default:
        return null;
    }
  }

  private async verifyPersonalIdentityWithQoreId(input: {
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
        return this.qoreIdService.verifyNin({
          nin: input.dto.nin,
          ...commonInput,
        });
      case 'PERSONAL_VNIN':
        if (!input.dto.vnin) {
          throw new BadRequestException(
            'vNIN is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyVirtualNin({
          vnin: input.dto.vnin,
          ...commonInput,
        });
      case 'PERSONAL_PASSPORT':
        if (!input.dto.passportNumber) {
          throw new BadRequestException(
            'Passport number is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyPassport({
          passportNumber: input.dto.passportNumber,
          ...commonInput,
        });
      case 'PERSONAL_PHONE_NIN':
      default:
        if (!(input.dto.phoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Phone number is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyNinByPhone({
          phoneNumber: input.dto.phoneNumber || input.user?.phoneNumber || '',
          ...commonInput,
        });
    }
  }

  private async verifyBusinessRepresentativeWithQoreId(input: {
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
        return this.qoreIdService.verifyNin({
          nin: input.dto.representativeNin,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_VNIN':
        if (!input.dto.representativeVnin) {
          throw new BadRequestException(
            'Representative vNIN is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyVirtualNin({
          vnin: input.dto.representativeVnin,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_PASSPORT':
        if (!input.dto.representativePassportNumber) {
          throw new BadRequestException(
            'Representative passport number is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyPassport({
          passportNumber: input.dto.representativePassportNumber,
          ...commonInput,
        });
      case 'BUSINESS_CAC_REP_PHONE_NIN':
      default:
        if (!(input.dto.representativePhoneNumber || input.user?.phoneNumber)) {
          throw new BadRequestException(
            'Representative phone number is required for this verification mode',
          );
        }
        return this.qoreIdService.verifyNinByPhone({
          phoneNumber:
            input.dto.representativePhoneNumber ||
            input.user?.phoneNumber ||
            '',
          ...commonInput,
        });
    }
  }

  private extractIdentityRecord(response?: QoreIdNinResponse | null) {
    if (!response) {
      return null;
    }

    return response.nin || response.virtual_nin || response.passport || null;
  }

  private extractQoreIdIdentityMatchStatus(response: QoreIdNinResponse) {
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

  private resolveQoreIdIdentityStatus(response: QoreIdNinResponse) {
    const verificationState = this.resolveQoreIdVerificationState(
      response.status?.status,
    );
    const matchStatus = this.extractQoreIdIdentityMatchStatus(response);
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

  private resolveQoreIdBusinessStatus(response: QoreIdCacResponse) {
    const verificationState = this.resolveQoreIdVerificationState(
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

  private resolveQoreIdFaceVerificationStatus(
    response: QoreIdFaceVerificationResponse,
  ) {
    const verificationState = this.resolveQoreIdVerificationState(
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

    return KycVerificationStatus.IN_PROGRESS;
  }

  private derivePayoutStateFromVerificationStatus(
    verificationStatus: KycVerificationStatus,
    accountOwnershipType: AccountOwnershipType,
    livenessStatus?: KycVerificationStatus | null,
  ) {
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

  private resolveQoreIdVerificationState(status?: string | null) {
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

  private summarizeQoreNubanResponse(
    response: QoreIdNubanResponse,
    ownershipType: AccountOwnershipType,
  ) {
    return {
      accountCheckId: String(response.id),
      accountVerificationMode:
        ownershipType === AccountOwnershipType.BUSINESS
          ? 'BUSINESS_NUBAN'
          : 'PERSONAL_NUBAN',
      providerStatus: response.status?.status || null,
      nubanCheckStatus: response.summary?.nuban_check?.status || null,
      accountName: response.nuban?.accountName || null,
      accountCurrency: response.nuban?.accountCurrency || null,
    };
  }

  private summarizeQoreNinResponse(
    response: QoreIdNinResponse,
    input: {
      verificationMode: string;
      identityType: string;
    },
  ) {
    const identityRecord = this.extractIdentityRecord(response);

    return {
      requestId: String(response.id),
      verificationMode: input.verificationMode,
      identityType: input.identityType,
      providerStatus: response.status?.status || null,
      matchStatus: this.extractQoreIdIdentityMatchStatus(response) || null,
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

  private summarizeQoreBusinessResponse(response: QoreIdCacResponse) {
    return {
      requestId: String(response.id),
      providerStatus: response.status?.status || null,
      cacCheckStatus: response.summary?.cac_check || null,
      companyName: response.cac?.companyName || null,
      companyType: response.cac?.companyType || null,
      rcNumberMasked: this.maskIdentityReference(
        response.cac?.rcNumber || null,
      ),
      registrationDate: response.cac?.registrationDate || null,
    };
  }

  private summarizeQoreFaceVerificationResponse(
    response: QoreIdFaceVerificationResponse,
  ) {
    return {
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

  private summarizeQoreWebhookPayload(payload: any) {
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

  private assertOpsKey(opsKey?: string) {
    const internalOpsKey = process.env.INTERNAL_OPS_KEY;

    if (!internalOpsKey || opsKey !== internalOpsKey) {
      throw new UnauthorizedException('Invalid ops key');
    }
  }
}

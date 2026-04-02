import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum CreatorPayoutProfileStatusDto {
  NOT_STARTED = 'NOT_STARTED',
  ACCOUNT_PROVIDED = 'ACCOUNT_PROVIDED',
  ACCOUNT_VERIFIED = 'ACCOUNT_VERIFIED',
  PENDING_KYC = 'PENDING_KYC',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  RESTRICTED = 'RESTRICTED',
}

export enum AccountOwnershipTypeDto {
  UNKNOWN = 'UNKNOWN',
  PERSONAL = 'PERSONAL',
  BUSINESS = 'BUSINESS',
}

export enum KycVerificationStatusDto {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_PROVIDER = 'PENDING_PROVIDER',
  SUBMITTED = 'SUBMITTED',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export enum KycVerificationModeDto {
  PERSONAL_NIN = 'PERSONAL_NIN',
  PERSONAL_VNIN = 'PERSONAL_VNIN',
  PERSONAL_PASSPORT = 'PERSONAL_PASSPORT',
  PERSONAL_PHONE_NIN = 'PERSONAL_PHONE_NIN',
  BUSINESS_CAC_REP_NIN = 'BUSINESS_CAC_REP_NIN',
  BUSINESS_CAC_REP_VNIN = 'BUSINESS_CAC_REP_VNIN',
  BUSINESS_CAC_REP_PASSPORT = 'BUSINESS_CAC_REP_PASSPORT',
  BUSINESS_CAC_REP_PHONE_NIN = 'BUSINESS_CAC_REP_PHONE_NIN',
}

export enum KycResolutionNotificationTargetDto {
  BUSINESS = 'BUSINESS',
  IDENTITY = 'IDENTITY',
  LIVENESS = 'LIVENESS',
}

export enum NameMatchStatusDto {
  NOT_CHECKED = 'NOT_CHECKED',
  MATCHED = 'MATCHED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
  MISMATCH = 'MISMATCH',
}

export enum CreatorAlatProfileStatusDto {
  NOT_STARTED = 'NOT_STARTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  REJECTED = 'REJECTED',
}

export enum WalletPaymentProviderDto {
  PAYSTACK = 'PAYSTACK',
  ALAT_TRANSFER = 'ALAT_TRANSFER',
}

export enum WalletPaymentTypeDto {
  TICKET = 'TICKET',
  REGISTRATION = 'REGISTRATION',
  DONATION = 'DONATION',
}

export enum WalletSettlementStatusDto {
  NOT_READY = 'NOT_READY',
  HELD_KYC = 'HELD_KYC',
  HELD_RISK = 'HELD_RISK',
  READY = 'READY',
  PROCESSING = 'PROCESSING',
  SETTLED = 'SETTLED',
  FAILED = 'FAILED',
}

export enum WalletRiskStatusDto {
  CLEAR = 'CLEAR',
  REVIEW = 'REVIEW',
  HOLD = 'HOLD',
  BLOCKED = 'BLOCKED',
}

export enum SettlementRecordStatusDto {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export class WalletBalanceDto {
  @ApiProperty({ example: 320000 })
  heldBalance: number;

  @ApiProperty({ example: 120000 })
  availableBalance: number;

  @ApiProperty({ example: 70000 })
  processingBalance: number;

  @ApiProperty({ example: 950000 })
  settledBalance: number;

  @ApiProperty({ example: 1460000 })
  totalCollected: number;

  @ApiProperty({ example: 'NGN' })
  currency: string;
}

export class CreatorPayoutProfileDto {
  @ApiProperty({ example: 'ACTIVE', enum: CreatorPayoutProfileStatusDto })
  status: CreatorPayoutProfileStatusDto;

  @ApiProperty({
    example: 'PERSONAL',
    enum: AccountOwnershipTypeDto,
  })
  accountOwnershipType: AccountOwnershipTypeDto;

  @ApiPropertyOptional({ example: 'Novusui Events Ltd' })
  businessName?: string | null;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  legalName?: string | null;

  @ApiPropertyOptional({ example: 'Wema Bank' })
  bankName?: string | null;

  @ApiPropertyOptional({ example: '035' })
  bankCode?: string | null;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  accountName?: string | null;

  @ApiPropertyOptional({ example: '******6789' })
  accountNumberMasked?: string | null;

  @ApiPropertyOptional({ example: '0123456789' })
  accountNumber?: string | null;

  @ApiPropertyOptional({ example: '1234' })
  bvnLast4?: string | null;

  @ApiProperty({
    example: 'NOT_STARTED',
    enum: KycVerificationStatusDto,
  })
  kycStatus: KycVerificationStatusDto;

  @ApiProperty({
    example: 'NOT_CHECKED',
    enum: NameMatchStatusDto,
  })
  nameMatchStatus: NameMatchStatusDto;

  @ApiPropertyOptional({ example: '2026-03-13T10:00:00.000Z' })
  accountVerifiedAt?: Date | null;

  @ApiPropertyOptional({ example: 'Awaiting KYC review' })
  rejectionReason?: string | null;

  @ApiPropertyOptional({ example: '2026-03-12T10:00:00.000Z' })
  submittedAt?: Date | null;

  @ApiPropertyOptional({ example: '2026-03-13T10:00:00.000Z' })
  approvedAt?: Date | null;
}

export class CreatorAlatProfileDto {
  @ApiProperty({ example: 'ACTIVE', enum: CreatorAlatProfileStatusDto })
  status: CreatorAlatProfileStatusDto;

  @ApiPropertyOptional({ example: 'GatherGo - Adebola Lateef' })
  displayName?: string | null;

  @ApiPropertyOptional({ example: 'alat-subaccount-001' })
  subaccountReference?: string | null;

  @ApiPropertyOptional({ example: '0123456789' })
  accountNumber?: string | null;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  accountName?: string | null;

  @ApiPropertyOptional({ example: '2026-03-13T10:00:00.000Z' })
  activatedAt?: Date | null;

  @ApiPropertyOptional({ example: 'Created manually on ALAT dashboard' })
  notes?: string | null;
}

export class WalletOnboardingTaskDto {
  @ApiProperty({ example: 'ADD_SETTLEMENT_ACCOUNT' })
  code: string;

  @ApiProperty({ example: 'Add settlement account' })
  title: string;

  @ApiProperty({ example: 'PENDING' })
  status: string;

  @ApiProperty({ example: true })
  blocking: boolean;
}

export class WalletOnboardingDto {
  @ApiProperty({ example: true })
  hasPaidEvent: boolean;

  @ApiProperty({ example: true })
  needsAttention: boolean;

  @ApiProperty({ example: true })
  showPersistentAlert: boolean;

  @ApiPropertyOptional({ example: 'ADD_SETTLEMENT_ACCOUNT' })
  nextAction?: string | null;

  @ApiProperty({ example: false })
  canReceiveSettlement: boolean;

  @ApiProperty({ example: false })
  canOfferAlatTransfer: boolean;

  @ApiProperty({ type: [WalletOnboardingTaskDto] })
  tasks: WalletOnboardingTaskDto[];

  @ApiProperty({ enum: CreatorPayoutProfileStatusDto })
  payoutProfileStatus: CreatorPayoutProfileStatusDto;

  @ApiProperty({ enum: KycVerificationStatusDto })
  kycStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: CreatorAlatProfileStatusDto })
  alatProfileStatus: CreatorAlatProfileStatusDto;
}

export class WalletKycStepDto {
  @ApiProperty({ example: 'IDENTITY' })
  code: string;

  @ApiProperty({ example: 'PENDING' })
  status: string;
}

export class WalletKycDto {
  @ApiProperty({ enum: KycVerificationStatusDto })
  status: KycVerificationStatusDto;

  @ApiProperty({ enum: AccountOwnershipTypeDto })
  accountOwnershipType: AccountOwnershipTypeDto;

  @ApiPropertyOptional({ enum: KycVerificationModeDto })
  verificationMode?: KycVerificationModeDto | null;

  @ApiProperty({ type: [WalletKycStepDto] })
  steps: WalletKycStepDto[];

  @ApiProperty({ enum: KycVerificationStatusDto })
  businessStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: KycVerificationStatusDto })
  identityStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: KycVerificationStatusDto })
  livenessStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: KycVerificationStatusDto })
  amlStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: KycVerificationStatusDto })
  dedupStatus: KycVerificationStatusDto;

  @ApiProperty({ enum: NameMatchStatusDto })
  nameMatchStatus: NameMatchStatusDto;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  verifiedFullName?: string | null;

  @ApiPropertyOptional({ example: 'GatherGo Events Ltd' })
  verifiedBusinessName?: string | null;

  @ApiPropertyOptional({ example: 'Identity details under review' })
  rejectionReason?: string | null;
}

export class SettlementAccountChangeDto {
  @ApiProperty({ example: 'sca_123' })
  id: string;

  @ApiPropertyOptional({ example: 'Wema Bank' })
  previousBankName?: string | null;

  @ApiPropertyOptional({ example: '******6789' })
  previousAccountNumberMasked?: string | null;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  previousAccountName?: string | null;

  @ApiPropertyOptional({ example: 'Wema Bank' })
  newBankName?: string | null;

  @ApiPropertyOptional({ example: '******4321' })
  newAccountNumberMasked?: string | null;

  @ApiPropertyOptional({ example: 'Adebola O. Lateef' })
  newAccountName?: string | null;

  @ApiProperty({ example: true })
  nameChanged: boolean;

  @ApiProperty({ example: false })
  ownershipTypeChanged: boolean;

  @ApiProperty({ example: true })
  requiresReview: boolean;

  @ApiProperty({ example: 'USER' })
  changedBy: string;

  @ApiPropertyOptional({ example: 'Creator updated payout account in app' })
  reason?: string | null;

  @ApiProperty({ example: '2026-03-13T10:00:00.000Z' })
  createdAt: Date;
}

export class WalletTransactionDto {
  @ApiProperty({ example: 'txn_123' })
  id: string;

  @ApiProperty({ enum: WalletPaymentTypeDto, example: 'TICKET' })
  paymentType: WalletPaymentTypeDto;

  @ApiProperty({ enum: WalletPaymentProviderDto, example: 'PAYSTACK' })
  paymentProvider: WalletPaymentProviderDto;

  @ApiProperty({ example: 25000 })
  grossAmount: number;

  @ApiProperty({ example: 2500 })
  platformFee: number;

  @ApiProperty({ example: 0 })
  providerFee: number;

  @ApiProperty({ example: 22500 })
  creatorPayable: number;

  @ApiProperty({ enum: WalletSettlementStatusDto, example: 'READY' })
  settlementStatus: WalletSettlementStatusDto;

  @ApiProperty({ enum: WalletRiskStatusDto, example: 'CLEAR' })
  riskStatus: WalletRiskStatusDto;

  @ApiProperty({ example: 0 })
  riskScore: number;

  @ApiProperty({
    type: [String],
    example: ['large_payment', 'new_buyer_account'],
  })
  riskReasons: string[];

  @ApiPropertyOptional({ example: 'Cleared after manual payment review' })
  riskReviewNote?: string | null;

  @ApiPropertyOptional({ example: '2026-03-13T10:00:00.000Z' })
  reviewedAt?: Date | null;

  @ApiPropertyOptional({ example: 'Launch Party' })
  eventTitle?: string | null;

  @ApiPropertyOptional({ example: 'buyer_username' })
  buyerUsername?: string | null;

  @ApiProperty({ example: '2026-03-12T10:00:00.000Z' })
  createdAt: Date;
}

export class SettlementDto {
  @ApiProperty({ example: 'stl_123' })
  id: string;

  @ApiProperty({ example: 'SET-20260312-001' })
  reference: string;

  @ApiProperty({ example: 150000 })
  amount: number;

  @ApiProperty({ enum: SettlementRecordStatusDto, example: 'PROCESSING' })
  status: SettlementRecordStatusDto;

  @ApiPropertyOptional({ example: 'Wema Bank' })
  destinationBankName?: string | null;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  destinationAccountName?: string | null;

  @ApiPropertyOptional({ example: '******6789' })
  destinationAccountNumber?: string | null;

  @ApiProperty({ example: 4 })
  transactionCount: number;

  @ApiProperty({ example: '2026-03-12T10:00:00.000Z' })
  createdAt: Date;

  @ApiPropertyOptional({ example: '2026-03-13T10:00:00.000Z' })
  processedAt?: Date | null;
}

export class WalletOverviewDto {
  @ApiProperty({ type: WalletBalanceDto })
  balance: WalletBalanceDto;

  @ApiProperty({ type: CreatorPayoutProfileDto, nullable: true })
  payoutProfile: CreatorPayoutProfileDto | null;

  @ApiProperty({ type: CreatorAlatProfileDto, nullable: true })
  alatProfile: CreatorAlatProfileDto | null;

  @ApiProperty({ type: [WalletTransactionDto] })
  recentTransactions: WalletTransactionDto[];

  @ApiProperty({ type: [SettlementDto] })
  recentSettlements: SettlementDto[];
}

export class UpsertPayoutProfileDto {
  @ApiPropertyOptional({ example: 'Novusui Events Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessName?: string;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  legalName?: string;

  @ApiProperty({
    example: 'PERSONAL',
    enum: AccountOwnershipTypeDto,
  })
  @IsEnum(AccountOwnershipTypeDto)
  accountOwnershipType: AccountOwnershipTypeDto;

  @ApiProperty({ example: 'Wema Bank' })
  @IsString()
  @MaxLength(120)
  bankName: string;

  @ApiPropertyOptional({ example: '035' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  bankCode?: string;

  @ApiProperty({ example: '0123456789' })
  @IsString()
  @MaxLength(32)
  accountNumber: string;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @ApiPropertyOptional({ example: '1234' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  bvnLast4?: string;
}

export class WalletTransactionsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: WalletPaymentTypeDto })
  @IsOptional()
  @IsEnum(WalletPaymentTypeDto)
  paymentType?: WalletPaymentTypeDto;

  @ApiPropertyOptional({ enum: WalletPaymentProviderDto })
  @IsOptional()
  @IsEnum(WalletPaymentProviderDto)
  paymentProvider?: WalletPaymentProviderDto;

  @ApiPropertyOptional({ enum: WalletSettlementStatusDto })
  @IsOptional()
  @IsEnum(WalletSettlementStatusDto)
  settlementStatus?: WalletSettlementStatusDto;

  @ApiPropertyOptional({ enum: WalletRiskStatusDto })
  @IsOptional()
  @IsEnum(WalletRiskStatusDto)
  riskStatus?: WalletRiskStatusDto;
}

export class WalletSettlementsQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: SettlementRecordStatusDto })
  @IsOptional()
  @IsEnum(SettlementRecordStatusDto)
  status?: SettlementRecordStatusDto;
}

export class InternalKycQueueQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: KycVerificationStatusDto })
  @IsOptional()
  @IsEnum(KycVerificationStatusDto)
  status?: KycVerificationStatusDto;

  @ApiPropertyOptional({ enum: CreatorPayoutProfileStatusDto })
  @IsOptional()
  @IsEnum(CreatorPayoutProfileStatusDto)
  profileStatus?: CreatorPayoutProfileStatusDto;

  @ApiPropertyOptional({ enum: AccountOwnershipTypeDto })
  @IsOptional()
  @IsEnum(AccountOwnershipTypeDto)
  accountOwnershipType?: AccountOwnershipTypeDto;

  @ApiPropertyOptional({ enum: NameMatchStatusDto })
  @IsOptional()
  @IsEnum(NameMatchStatusDto)
  nameMatchStatus?: NameMatchStatusDto;

  @ApiPropertyOptional({
    example: false,
    description:
      'Filter by whether the KYC profile has already been manually reviewed',
  })
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;
}

export class InternalAlatQueueQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: CreatorPayoutProfileStatusDto })
  @IsOptional()
  @IsEnum(CreatorPayoutProfileStatusDto)
  profileStatus?: CreatorPayoutProfileStatusDto;

  @ApiPropertyOptional({ enum: CreatorAlatProfileStatusDto })
  @IsOptional()
  @IsEnum(CreatorAlatProfileStatusDto)
  alatStatus?: CreatorAlatProfileStatusDto;

  @ApiPropertyOptional({
    example: true,
    description:
      'Show creators that still need ALAT setup or activation attention',
  })
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  needsAction?: boolean;
}

export class ReviewPayoutProfileDto {
  @ApiProperty({ enum: CreatorPayoutProfileStatusDto })
  @IsEnum(CreatorPayoutProfileStatusDto)
  status: CreatorPayoutProfileStatusDto;

  @ApiPropertyOptional({ example: 'Name mismatch on account review' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class ReviewKycDto {
  @ApiProperty({ enum: KycVerificationStatusDto })
  @IsEnum(KycVerificationStatusDto)
  status: KycVerificationStatusDto;

  @ApiProperty({ enum: NameMatchStatusDto })
  @IsEnum(NameMatchStatusDto)
  nameMatchStatus: NameMatchStatusDto;

  @ApiPropertyOptional({ example: 'Verified identity matched payout account' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    example: 'Submitted business account does not match CAC record',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class StartPersonalKycDto {
  @ApiPropertyOptional({ enum: KycVerificationModeDto })
  @IsOptional()
  @IsEnum(KycVerificationModeDto)
  verificationMode?: KycVerificationModeDto;

  @ApiPropertyOptional({ example: '08030000000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  nin?: string;

  @ApiPropertyOptional({ example: '11122233344' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  vnin?: string;

  @ApiPropertyOptional({ example: 'A12345678' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  passportNumber?: string;

  @ApiPropertyOptional({ example: 'Adebola' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @ApiPropertyOptional({ example: '1990-10-08' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  dateOfBirth?: string;
}

export class PersonalLivenessDto {
  @ApiPropertyOptional({ example: 'https://cdn.example.com/selfie.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  identityNumber?: string;

  @ApiPropertyOptional({ example: 'data:image/jpeg;base64,...' })
  @IsOptional()
  @IsString()
  @MaxLength(10000000)
  photoBase64?: string;
}

export class StartBusinessKycDto {
  @ApiProperty({ example: '33029090' })
  @IsString()
  @MaxLength(64)
  regNumber: string;

  @ApiPropertyOptional({ example: 'GatherGo Events Ltd' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  businessName?: string;
}

export class StartBusinessRepresentativeKycDto {
  @ApiPropertyOptional({ enum: KycVerificationModeDto })
  @IsOptional()
  @IsEnum(KycVerificationModeDto)
  verificationMode?: KycVerificationModeDto;

  @ApiPropertyOptional({ example: '08030000000' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  representativePhoneNumber?: string;

  @ApiPropertyOptional({ example: 'Adebola' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  representativeFirstName?: string;

  @ApiPropertyOptional({ example: 'Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  representativeLastName?: string;

  @ApiPropertyOptional({ example: '1990-10-08' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  representativeDateOfBirth?: string;

  @ApiPropertyOptional({ example: '12345678901' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  representativeNin?: string;

  @ApiPropertyOptional({ example: '11122233344' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  representativeVnin?: string;

  @ApiPropertyOptional({ example: 'A12345678' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  representativePassportNumber?: string;
}

export class SubmitKycDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  confirm: boolean;
}

export class NotifyOnKycResolutionDto {
  @ApiProperty({ enum: KycResolutionNotificationTargetDto })
  @IsEnum(KycResolutionNotificationTargetDto)
  target: KycResolutionNotificationTargetDto;
}

export class AccountChangesQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

export class UpsertAlatProfileDto {
  @ApiProperty({ enum: CreatorAlatProfileStatusDto })
  @IsEnum(CreatorAlatProfileStatusDto)
  status: CreatorAlatProfileStatusDto;

  @ApiPropertyOptional({ example: 'creator-business-001' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  businessId?: string;

  @ApiPropertyOptional({ example: 'GatherGo - Adebola Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  displayName?: string;

  @ApiPropertyOptional({ example: 'alat-subaccount-001' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subaccountReference?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'Adebola Lateef' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @ApiPropertyOptional({ example: 'Created manually on ALAT dashboard' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateSettlementDto {
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  transactionIds?: string[];
}

export class CompleteSettlementDto {
  @ApiProperty({ enum: SettlementRecordStatusDto, example: 'SUCCESS' })
  @IsEnum(SettlementRecordStatusDto)
  status: SettlementRecordStatusDto;

  @ApiPropertyOptional({
    example: 'Settlement completed through manual bank transfer',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

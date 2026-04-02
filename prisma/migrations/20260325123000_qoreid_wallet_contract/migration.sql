-- CreateEnum
CREATE TYPE "AccountOwnershipType" AS ENUM ('UNKNOWN', 'PERSONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "KycVerificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NameMatchStatus" AS ENUM ('NOT_CHECKED', 'MATCHED', 'REVIEW_REQUIRED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "VerificationProvider" AS ENUM ('QOREID');

-- AlterEnum
ALTER TYPE "CreatorSettlementProfileStatus" ADD VALUE IF NOT EXISTS 'ACCOUNT_PROVIDED';

-- AlterEnum
ALTER TYPE "CreatorSettlementProfileStatus" ADD VALUE IF NOT EXISTS 'ACCOUNT_VERIFIED';

-- AlterEnum
ALTER TYPE "CreatorSettlementProfileStatus" ADD VALUE IF NOT EXISTS 'REVIEW_REQUIRED';

-- AlterTable
ALTER TABLE "CreatorSettlementProfile"
ADD COLUMN "accountOwnershipType" "AccountOwnershipType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN "bankCode" TEXT,
ADD COLUMN "accountNumberMasked" TEXT,
ADD COLUMN "accountVerifiedAt" TIMESTAMP(3),
ADD COLUMN "kycStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN "nameMatchStatus" "NameMatchStatus" NOT NULL DEFAULT 'NOT_CHECKED';

-- Backfill existing payout profiles to sensible defaults
UPDATE "CreatorSettlementProfile"
SET "accountNumberMasked" = CASE
  WHEN "accountNumber" IS NULL THEN NULL
  WHEN LENGTH("accountNumber") <= 4 THEN "accountNumber"
  ELSE repeat('*', LENGTH("accountNumber") - 4) || RIGHT("accountNumber", 4)
END
WHERE "accountNumberMasked" IS NULL;

UPDATE "CreatorSettlementProfile"
SET "accountVerifiedAt" = COALESCE("submittedAt", "createdAt")
WHERE "accountNumber" IS NOT NULL
  AND "accountVerifiedAt" IS NULL;

UPDATE "CreatorSettlementProfile"
SET "kycStatus" = CASE
  WHEN "status" = 'ACTIVE' THEN 'VERIFIED'::"KycVerificationStatus"
  WHEN "status" = 'REJECTED' THEN 'REJECTED'::"KycVerificationStatus"
  WHEN "status" = 'PENDING_KYC' THEN 'IN_PROGRESS'::"KycVerificationStatus"
  ELSE 'NOT_STARTED'::"KycVerificationStatus"
END;

UPDATE "CreatorSettlementProfile"
SET "nameMatchStatus" = CASE
  WHEN "status" = 'ACTIVE' THEN 'MATCHED'::"NameMatchStatus"
  WHEN "status" = 'REJECTED' THEN 'MISMATCH'::"NameMatchStatus"
  ELSE 'NOT_CHECKED'::"NameMatchStatus"
END;

-- CreateTable
CREATE TABLE "CreatorKycVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settlementProfileId" TEXT NOT NULL,
    "provider" "VerificationProvider" NOT NULL DEFAULT 'QOREID',
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "accountOwnershipType" "AccountOwnershipType" NOT NULL DEFAULT 'UNKNOWN',
    "phoneNumber" TEXT,
    "identityType" TEXT,
    "identityReferenceMasked" TEXT,
    "verifiedFullName" TEXT,
    "verifiedBusinessName" TEXT,
    "verifiedDateOfBirth" TIMESTAMP(3),
    "qoreIdentityCheckId" TEXT,
    "qoreLivenessCheckId" TEXT,
    "qoreAmlCheckId" TEXT,
    "identityStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "livenessStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "amlStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "dedupStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "nameMatchStatus" "NameMatchStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "nameMatchScore" DOUBLE PRECISION,
    "nameMatchReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorKycVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAccountChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "settlementProfileId" TEXT NOT NULL,
    "previousBankName" TEXT,
    "previousBankCode" TEXT,
    "previousAccountNumberMasked" TEXT,
    "previousAccountName" TEXT,
    "previousOwnershipType" "AccountOwnershipType",
    "newBankName" TEXT,
    "newBankCode" TEXT,
    "newAccountNumberMasked" TEXT,
    "newAccountName" TEXT,
    "newOwnershipType" "AccountOwnershipType",
    "nameChanged" BOOLEAN NOT NULL DEFAULT false,
    "ownershipTypeChanged" BOOLEAN NOT NULL DEFAULT false,
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAccountChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorKycVerification_userId_key" ON "CreatorKycVerification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorKycVerification_settlementProfileId_key" ON "CreatorKycVerification"("settlementProfileId");

-- CreateIndex
CREATE INDEX "SettlementAccountChange_userId_createdAt_idx" ON "SettlementAccountChange"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreatorKycVerification"
ADD CONSTRAINT "CreatorKycVerification_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorKycVerification"
ADD CONSTRAINT "CreatorKycVerification_settlementProfileId_fkey"
FOREIGN KEY ("settlementProfileId") REFERENCES "CreatorSettlementProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAccountChange"
ADD CONSTRAINT "SettlementAccountChange_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAccountChange"
ADD CONSTRAINT "SettlementAccountChange_settlementProfileId_fkey"
FOREIGN KEY ("settlementProfileId") REFERENCES "CreatorSettlementProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

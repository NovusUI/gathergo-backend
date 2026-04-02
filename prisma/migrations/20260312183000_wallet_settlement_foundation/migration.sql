-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'ALAT_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('TICKET', 'REGISTRATION', 'DONATION');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_READY', 'HELD_KYC', 'HELD_RISK', 'READY', 'PROCESSING', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('CLEAR', 'REVIEW', 'HOLD', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CreatorSettlementProfileStatus" AS ENUM ('NOT_STARTED', 'PENDING_KYC', 'ACTIVE', 'REJECTED', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "SettlementRecordStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreatorAlatProfileStatus" AS ENUM ('NOT_STARTED', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'REJECTED');

-- AlterEnum
ALTER TYPE "TransactionStatusType" ADD VALUE IF NOT EXISTS 'AWAITING_TRANSFER';

-- AlterTable
ALTER TABLE "TransactionReference"
ADD COLUMN "creatorId" TEXT,
ADD COLUMN "platformFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "providerFee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "creatorPayable" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "riskReasons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
ADD COLUMN "paymentType" "PaymentType",
ADD COLUMN "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'NOT_READY',
ADD COLUMN "riskStatus" "RiskStatus" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "providerReference" TEXT,
ADD COLUMN "providerPayload" JSONB,
ADD COLUMN "fulfilledAt" TIMESTAMP(3),
ADD COLUMN "settledAt" TIMESTAMP(3),
ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CreatorSettlementProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT,
    "businessName" TEXT,
    "status" "CreatorSettlementProfileStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "bvnLast4" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorSettlementProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorAlatProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CreatorAlatProfileStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "displayName" TEXT,
    "subaccountReference" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorAlatProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRecord" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "SettlementRecordStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT NOT NULL,
    "destinationBankName" TEXT,
    "destinationAccountNumber" TEXT,
    "destinationAccountName" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SettlementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAllocation" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "transactionReferenceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventKey" TEXT NOT NULL,
    "transactionReferenceId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorSettlementProfile_userId_key" ON "CreatorSettlementProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorAlatProfile_userId_key" ON "CreatorAlatProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRecord_reference_key" ON "SettlementRecord"("reference");

-- CreateIndex
CREATE INDEX "SettlementRecord_creatorId_status_idx" ON "SettlementRecord"("creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAllocation_transactionReferenceId_key" ON "SettlementAllocation"("transactionReferenceId");

-- CreateIndex
CREATE INDEX "SettlementAllocation_settlementId_idx" ON "SettlementAllocation"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderWebhookEvent_eventKey_key" ON "ProviderWebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ProviderWebhookEvent_provider_createdAt_idx" ON "ProviderWebhookEvent"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "TransactionReference_eventId_status_idx" ON "TransactionReference"("eventId", "status");

-- CreateIndex
CREATE INDEX "TransactionReference_creatorId_status_idx" ON "TransactionReference"("creatorId", "status");

-- CreateIndex
CREATE INDEX "TransactionReference_creatorId_settlementStatus_idx" ON "TransactionReference"("creatorId", "settlementStatus");

-- CreateIndex
CREATE INDEX "TransactionReference_paymentProvider_status_idx" ON "TransactionReference"("paymentProvider", "status");

-- CreateIndex
CREATE INDEX "TransactionReference_riskStatus_idx" ON "TransactionReference"("riskStatus");

-- Safe data normalization for existing transactions
UPDATE "TransactionReference"
SET "amount" = "amount" * 100
WHERE COALESCE("metadata"->>'amountUnit', '') <> 'KOBO'
  AND "amount" > 0;

UPDATE "TransactionReference"
SET "metadata" = jsonb_set(
  COALESCE("metadata"::jsonb, '{}'::jsonb),
  '{amountUnit}',
  '"KOBO"'::jsonb,
  true
)
WHERE COALESCE("metadata"->>'amountUnit', '') <> 'KOBO';

UPDATE "TransactionReference" tr
SET "creatorId" = e."creatorId"
FROM "Event" e
WHERE tr."eventId" = e."id"
  AND tr."creatorId" IS NULL;

UPDATE "TransactionReference"
SET "paymentType" = CASE
  WHEN COALESCE("metadata"->>'type', '') = 'REGISTRATION' THEN 'REGISTRATION'::"PaymentType"
  WHEN COALESCE("metadata"->>'type', '') = 'DONATION' THEN 'DONATION'::"PaymentType"
  ELSE 'TICKET'::"PaymentType"
END
WHERE "paymentType" IS NULL;

UPDATE "TransactionReference"
SET "settlementStatus" = CASE
  WHEN "status" = 'SUCCESS' THEN 'HELD_KYC'::"SettlementStatus"
  WHEN "status" = 'FAILED' THEN 'FAILED'::"SettlementStatus"
  ELSE 'NOT_READY'::"SettlementStatus"
END
WHERE "settlementStatus" = 'NOT_READY';

-- AddForeignKey
ALTER TABLE "TransactionReference"
ADD CONSTRAINT "TransactionReference_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorSettlementProfile"
ADD CONSTRAINT "CreatorSettlementProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorAlatProfile"
ADD CONSTRAINT "CreatorAlatProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementRecord"
ADD CONSTRAINT "SettlementRecord_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation"
ADD CONSTRAINT "SettlementAllocation_settlementId_fkey"
FOREIGN KEY ("settlementId") REFERENCES "SettlementRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation"
ADD CONSTRAINT "SettlementAllocation_transactionReferenceId_fkey"
FOREIGN KEY ("transactionReferenceId") REFERENCES "TransactionReference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderWebhookEvent"
ADD CONSTRAINT "ProviderWebhookEvent_transactionReferenceId_fkey"
FOREIGN KEY ("transactionReferenceId") REFERENCES "TransactionReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

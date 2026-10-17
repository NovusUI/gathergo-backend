-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CheckoutInitializationStatus" AS ENUM ('NOT_STARTED', 'INITIALIZING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "CheckoutRefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'REFUNDED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "CheckoutJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionStatusType" ADD VALUE 'EXPIRED';
ALTER TYPE "TransactionStatusType" ADD VALUE 'REFUND_REQUIRED';
ALTER TYPE "TransactionStatusType" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "fulfillmentKey" TEXT;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "fulfillmentKey" TEXT;

-- AlterTable
ALTER TABLE "TransactionReference" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "initializationStartedAt" TIMESTAMP(3),
ADD COLUMN     "initializationStatus" "CheckoutInitializationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "paymentUrl" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "ProviderWebhookEvent" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CheckoutReservation" (
    "transactionId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutReservation_pkey" PRIMARY KEY ("transactionId")
);

-- CreateTable
CREATE TABLE "CheckoutReservationItem" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "eventTicketId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "CheckoutReservationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutRefund" (
    "transactionId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "CheckoutRefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "providerTransactionId" TEXT,
    "providerRefundId" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "confirmedReference" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutRefund_pkey" PRIMARY KEY ("transactionId")
);

-- CreateTable
CREATE TABLE "CheckoutFulfillmentJob" (
    "transactionId" TEXT NOT NULL,
    "status" "CheckoutJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "CheckoutFulfillmentJob_pkey" PRIMARY KEY ("transactionId")
);

-- CreateIndex
CREATE INDEX "CheckoutReservation_status_expiresAt_idx" ON "CheckoutReservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CheckoutReservationItem_eventTicketId_idx" ON "CheckoutReservationItem"("eventTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckoutReservationItem_reservationId_eventTicketId_key" ON "CheckoutReservationItem"("reservationId", "eventTicketId");

-- CreateIndex
CREATE INDEX "CheckoutRefund_status_nextAttemptAt_idx" ON "CheckoutRefund"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CheckoutFulfillmentJob_status_nextAttemptAt_idx" ON "CheckoutFulfillmentJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_fulfillmentKey_key" ON "Ticket"("fulfillmentKey");

-- CreateIndex
CREATE INDEX "Ticket_transactionId_idx" ON "Ticket"("transactionId");

-- CreateIndex
CREATE INDEX "Ticket_eventTicketId_status_idx" ON "Ticket"("eventTicketId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Registration_fulfillmentKey_key" ON "Registration"("fulfillmentKey");

-- CreateIndex
CREATE INDEX "Registration_transactionId_idx" ON "Registration"("transactionId");

-- CreateIndex
CREATE INDEX "Registration_eventId_userId_status_idx" ON "Registration"("eventId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionReference_userId_idempotencyKey_key" ON "TransactionReference"("userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CheckoutReservation" ADD CONSTRAINT "CheckoutReservation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransactionReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutReservationItem" ADD CONSTRAINT "CheckoutReservationItem_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "CheckoutReservation"("transactionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutReservationItem" ADD CONSTRAINT "CheckoutReservationItem_eventTicketId_fkey" FOREIGN KEY ("eventTicketId") REFERENCES "EventTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutRefund" ADD CONSTRAINT "CheckoutRefund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransactionReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutFulfillmentJob" ADD CONSTRAINT "CheckoutFulfillmentJob_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TransactionReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve existing admissions and assign deterministic fulfillment identities.
WITH numbered AS (
  SELECT "id", "transactionId", "eventTicketId", row_number() OVER (PARTITION BY "transactionId", "eventTicketId" ORDER BY "createdAt", "id") AS ordinal FROM "Ticket"
)
UPDATE "Ticket" t SET "fulfillmentKey" = n."transactionId" || ':' || n."eventTicketId" || ':' || n.ordinal FROM numbered n WHERE t."id" = n."id";
WITH numbered AS (
  SELECT "id", "transactionId", row_number() OVER (PARTITION BY "transactionId" ORDER BY "createdAt", "id") AS ordinal FROM "Registration"
)
UPDATE "Registration" r SET "fulfillmentKey" = n."transactionId" FROM numbered n WHERE r."id" = n."id" AND n.ordinal = 1;
UPDATE "EventTicket" et SET "sold" = GREATEST(et."sold", counts.issued) FROM (SELECT "eventTicketId", count(*)::integer AS issued FROM "Ticket" GROUP BY "eventTicketId") counts WHERE et."id" = counts."eventTicketId";
UPDATE "ProviderWebhookEvent" w SET "processedAt" = CURRENT_TIMESTAMP FROM "TransactionReference" t WHERE w."transactionReferenceId" = t."id" AND t."status" = 'SUCCESS';
-- Sponsored registrations consume capacity even though their beneficiary is assigned later.
INSERT INTO "CheckoutReservation" ("transactionId", "status", "expiresAt")
SELECT "id", 'CONFIRMED', "createdAt" FROM "TransactionReference" WHERE "status" = 'SUCCESS' AND "paymentType" = 'REGISTRATION' AND "metadata" #>> '{sponsorship,beneficiaryType}' = 'SPONSORED';

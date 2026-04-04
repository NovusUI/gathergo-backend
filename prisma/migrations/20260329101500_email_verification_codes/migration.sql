ALTER TABLE "User"
ADD COLUMN "emailVerificationCodeHash" TEXT,
ADD COLUMN "emailVerificationCodeExpiry" TIMESTAMP(3),
ADD COLUMN "emailVerificationSentAt" TIMESTAMP(3),
ADD COLUMN "emailVerificationAttempts" INTEGER NOT NULL DEFAULT 0;

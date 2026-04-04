ALTER TABLE "CreatorKycVerification"
ADD COLUMN IF NOT EXISTS "verificationMode" TEXT,
ADD COLUMN IF NOT EXISTS "qoreBusinessCheckId" TEXT,
ADD COLUMN IF NOT EXISTS "businessStatus" "KycVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED';

ALTER TABLE "CreatorKycVerification"
ADD COLUMN     "identityReferenceLast4" TEXT,
ADD COLUMN     "providerSubjectHash" TEXT,
ADD COLUMN     "providerSubjectLast4" TEXT,
ADD COLUMN     "businessReferenceHash" TEXT,
ADD COLUMN     "businessReferenceLast4" TEXT,
ADD COLUMN     "nameDobHash" TEXT;

CREATE INDEX "CreatorKycVerification_providerSubjectHash_idx" ON "CreatorKycVerification"("providerSubjectHash");

CREATE INDEX "CreatorKycVerification_businessReferenceHash_idx" ON "CreatorKycVerification"("businessReferenceHash");

CREATE INDEX "CreatorKycVerification_nameDobHash_idx" ON "CreatorKycVerification"("nameDobHash");

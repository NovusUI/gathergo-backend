ALTER TABLE "Event"
ADD COLUMN "impactSdgGoals" JSONB,
ADD COLUMN "impactPaths" JSONB,
ADD COLUMN "impactCommitments" JSONB,
ADD COLUMN "impactMapSource" TEXT,
ADD COLUMN "impactMapGeneratedAt" TIMESTAMP(3);

ALTER TABLE "UserPreference"
ADD COLUMN "helpModes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "learningEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "learningSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE TYPE "InterestSignalKind" AS ENUM ('LIKE', 'VIEW');
CREATE TABLE "InterestSignal" (
  "id" TEXT NOT NULL,
  "preferenceId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "kind" "InterestSignalKind" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InterestSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InterestSignal_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "UserPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InterestSignal_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "InterestSignal_preferenceId_eventId_kind_key" ON "InterestSignal"("preferenceId", "eventId", "kind");
CREATE INDEX "InterestSignal_preferenceId_createdAt_idx" ON "InterestSignal"("preferenceId", "createdAt");

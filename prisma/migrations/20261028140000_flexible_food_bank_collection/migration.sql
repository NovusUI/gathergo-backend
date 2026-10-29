CREATE TYPE "FoodBankCollectionStatus" AS ENUM ('NOT_STARTED', 'OPEN', 'PAUSED', 'CLOSED');
ALTER TABLE "Event"
  ADD COLUMN "foodBankCollectionStatus" "FoodBankCollectionStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "foodBankTimeZone" TEXT NOT NULL DEFAULT 'Africa/Lagos';

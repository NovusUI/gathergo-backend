
-- AlterEnum
ALTER TYPE "RegistrationType" ADD VALUE 'donation';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "donationTarget" INTEGER;

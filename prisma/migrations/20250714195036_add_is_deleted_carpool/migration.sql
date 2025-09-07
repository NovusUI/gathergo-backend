-- AlterTable
ALTER TABLE "Carpool" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "pricePerSeat" SET DEFAULT 0;

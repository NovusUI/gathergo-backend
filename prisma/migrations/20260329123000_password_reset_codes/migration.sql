-- AlterTable
ALTER TABLE "User"
ADD COLUMN "resetTokenSentAt" TIMESTAMP(3),
ADD COLUMN "resetTokenAttempts" INTEGER NOT NULL DEFAULT 0;

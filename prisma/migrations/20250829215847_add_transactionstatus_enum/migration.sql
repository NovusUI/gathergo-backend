/*
  Warnings:

  - The `status` column on the `TransactionReference` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "TransactionStatusType" AS ENUM ('SUCCESS', 'PENDING', 'FAILED');

-- AlterTable
ALTER TABLE "TransactionReference" DROP COLUMN "status",
ADD COLUMN     "status" "TransactionStatusType" NOT NULL DEFAULT 'PENDING';

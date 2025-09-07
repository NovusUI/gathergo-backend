/*
  Warnings:

  - You are about to drop the column `eventId` on the `TransactionReference` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "TransactionReference" DROP CONSTRAINT "TransactionReference_eventId_fkey";

-- AlterTable
ALTER TABLE "TransactionReference" DROP COLUMN "eventId";

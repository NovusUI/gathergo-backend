/*
  Warnings:

  - You are about to drop the column `eventTicketId` on the `TransactionReference` table. All the data in the column will be lost.
  - You are about to alter the column `amount` on the `TransactionReference` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Added the required column `items` to the `TransactionReference` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "TransactionReference" DROP CONSTRAINT "TransactionReference_eventTicketId_fkey";

-- AlterTable
ALTER TABLE "TransactionReference" DROP COLUMN "eventTicketId",
ADD COLUMN     "items" JSONB NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE INTEGER;

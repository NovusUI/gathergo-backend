/*
  Warnings:

  - You are about to drop the column `reference` on the `TransactionReference` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "TransactionReference_reference_key";

-- AlterTable
ALTER TABLE "TransactionReference" DROP COLUMN "reference";

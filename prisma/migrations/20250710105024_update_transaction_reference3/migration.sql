/*
  Warnings:

  - Made the column `metadata` on table `TransactionReference` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "TransactionReference" ALTER COLUMN "metadata" SET NOT NULL;

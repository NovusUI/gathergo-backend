/*
  Warnings:

  - Added the required column `metadate` to the `TransactionReference` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TransactionReference" ADD COLUMN     "metadate" JSONB NOT NULL;

/*
  Warnings:

  - You are about to drop the column `metadate` on the `TransactionReference` table. All the data in the column will be lost.
  - Added the required column `metadata` to the `TransactionReference` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "TransactionReference" DROP COLUMN "metadate",
ADD COLUMN     "metadata" JSONB NOT NULL;

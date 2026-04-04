/*
  Warnings:

  - You are about to drop the column `eventId` on the `ScannerPermission` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[ownerId,scannerId]` on the table `ScannerPermission` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "ScannerPermission" DROP CONSTRAINT "ScannerPermission_eventId_fkey";

-- DropIndex
DROP INDEX "ScannerPermission_eventId_scannerId_key";

-- AlterTable
ALTER TABLE "ScannerPermission" DROP COLUMN "eventId";

-- CreateIndex
CREATE UNIQUE INDEX "ScannerPermission_ownerId_scannerId_key" ON "ScannerPermission"("ownerId", "scannerId");

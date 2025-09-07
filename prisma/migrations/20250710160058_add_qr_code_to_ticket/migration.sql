/*
  Warnings:

  - You are about to drop the column `followedCommunities` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `followersCount` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `followingCount` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[qrCode]` on the table `Ticket` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `qrCode` to the `Ticket` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "qrCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "followedCommunities",
DROP COLUMN "followersCount",
DROP COLUMN "followingCount";

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_qrCode_key" ON "Ticket"("qrCode");



/*
  Warnings:

  - Added the required column `note` to the `CarpoolPassenger` table without a default value. This is not possible if the table is not empty.
  - Added the required column `origin` to the `CarpoolPassenger` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CarpoolPassenger" ADD COLUMN     "note" TEXT NOT NULL,
ADD COLUMN     "origin" TEXT NOT NULL,
ADD COLUMN     "startPoint" geometry(Point, 4326);

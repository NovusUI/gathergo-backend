/*
  Warnings:

  - The `registrationType` column on the `Event` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('NONE', 'WEEKLY', 'DAILY');

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "registrationType",
ADD COLUMN     "registrationType" "RegistrationType";

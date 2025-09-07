/*
  Warnings:

  - The values [NONE,WEEKLY,DAILY] on the enum `RegistrationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "RegistrationType_new" AS ENUM ('ticket', 'registration');
ALTER TABLE "Event" ALTER COLUMN "registrationType" TYPE "RegistrationType_new" USING ("registrationType"::text::"RegistrationType_new");
ALTER TYPE "RegistrationType" RENAME TO "RegistrationType_old";
ALTER TYPE "RegistrationType_new" RENAME TO "RegistrationType";
DROP TYPE "RegistrationType_old";
COMMIT;

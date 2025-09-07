-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "endRepeat" TIMESTAMP(3),
ADD COLUMN     "registrationAttendees" INTEGER,
ADD COLUMN     "registrationFee" INTEGER,
ADD COLUMN     "registrationType" TEXT;

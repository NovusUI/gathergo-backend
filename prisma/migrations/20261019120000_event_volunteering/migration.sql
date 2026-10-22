-- CreateEnum
CREATE TYPE "VolunteerStatus" AS ENUM ('APPLIED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CHECKED_IN', 'COMPLETED');

-- AlterEnum
ALTER TYPE "RegistrationType" ADD VALUE 'volunteer';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "donationsEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Event" SET "donationsEnabled" = true WHERE "registrationType" = 'donation';

-- CreateTable
CREATE TABLE "VolunteerRole" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VolunteerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventVolunteer" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VolunteerStatus" NOT NULL DEFAULT 'APPLIED',
    "note" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "confirmedMinutes" INTEGER,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventVolunteer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VolunteerRole_eventId_idx" ON "VolunteerRole"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VolunteerRole_id_eventId_key" ON "VolunteerRole"("id", "eventId");

-- CreateIndex
CREATE INDEX "EventVolunteer_roleId_status_idx" ON "EventVolunteer"("roleId", "status");

-- CreateIndex
CREATE INDEX "EventVolunteer_userId_status_idx" ON "EventVolunteer"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventVolunteer_eventId_userId_key" ON "EventVolunteer"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "VolunteerRole" ADD CONSTRAINT "VolunteerRole_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVolunteer" ADD CONSTRAINT "EventVolunteer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVolunteer" ADD CONSTRAINT "EventVolunteer_roleId_eventId_fkey" FOREIGN KEY ("roleId", "eventId") REFERENCES "VolunteerRole"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVolunteer" ADD CONSTRAINT "EventVolunteer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventVolunteer" ADD CONSTRAINT "EventVolunteer_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


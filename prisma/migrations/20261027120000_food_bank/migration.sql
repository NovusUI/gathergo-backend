ALTER TYPE "RegistrationType" ADD VALUE 'foodbank';
ALTER TABLE "Event" ADD COLUMN "foodBankTotalMeals" INTEGER,
 ADD COLUMN "foodBankSlotCapacity" INTEGER,
 ADD COLUMN "foodBankSlotMinutes" INTEGER;
CREATE TABLE "MealPass" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "eventId" TEXT NOT NULL,
 "qrCode" TEXT NOT NULL,
 "collectionStart" TIMESTAMP(3) NOT NULL,
 "collectionEnd" TIMESTAMP(3) NOT NULL,
 "isUsed" BOOLEAN NOT NULL DEFAULT false,
 "collectedAt" TIMESTAMP(3),
 "collectedBy" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "MealPass_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "MealPass_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MealPass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MealPass_qrCode_key" ON "MealPass"("qrCode");
CREATE UNIQUE INDEX "MealPass_eventId_userId_key" ON "MealPass"("eventId", "userId");
CREATE INDEX "MealPass_eventId_collectionStart_idx" ON "MealPass"("eventId", "collectionStart");
CREATE INDEX "MealPass_userId_idx" ON "MealPass"("userId");

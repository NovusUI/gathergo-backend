
-- AlterTable
ALTER TABLE "TransactionReference" ADD COLUMN     "eventId" TEXT;

-- AddForeignKey
ALTER TABLE "TransactionReference" ADD CONSTRAINT "TransactionReference_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

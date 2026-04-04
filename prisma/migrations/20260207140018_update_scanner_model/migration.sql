
-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "scanLocation" TEXT,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "scannedBy" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "scanLocation" TEXT,
ADD COLUMN     "scannedAt" TIMESTAMP(3),
ADD COLUMN     "scannedBy" TEXT;

-- CreateTable
CREATE TABLE "ScannerPermission" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "scannerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ScannerPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qrCode" TEXT NOT NULL,
    "scannedById" TEXT NOT NULL,
    "eventId" TEXT,
    "ticketId" TEXT,
    "registrationId" TEXT,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScannerPermission_eventId_scannerId_key" ON "ScannerPermission"("eventId", "scannerId");

-- CreateIndex
CREATE INDEX "ScanLog_qrCode_idx" ON "ScanLog"("qrCode");

-- CreateIndex
CREATE INDEX "ScanLog_scannedById_idx" ON "ScanLog"("scannedById");

-- CreateIndex
CREATE INDEX "ScanLog_createdAt_idx" ON "ScanLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ScannerPermission" ADD CONSTRAINT "ScannerPermission_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerPermission" ADD CONSTRAINT "ScannerPermission_scannerId_fkey" FOREIGN KEY ("scannerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerPermission" ADD CONSTRAINT "ScannerPermission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

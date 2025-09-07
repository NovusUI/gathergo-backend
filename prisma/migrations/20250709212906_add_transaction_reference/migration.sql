-- CreateTable
CREATE TABLE "TransactionReference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventTicketId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionReference_reference_key" ON "TransactionReference"("reference");

-- AddForeignKey
ALTER TABLE "TransactionReference" ADD CONSTRAINT "TransactionReference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionReference" ADD CONSTRAINT "TransactionReference_eventTicketId_fkey" FOREIGN KEY ("eventTicketId") REFERENCES "EventTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

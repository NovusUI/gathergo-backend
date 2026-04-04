
-- CreateTable
CREATE TABLE "Feed" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "userId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "pinOrder" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HiddenFeed" (
    "userId" TEXT NOT NULL,
    "feedId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenFeed_pkey" PRIMARY KEY ("userId","feedId")
);

-- CreateIndex
CREATE INDEX "Feed_eventId_createdAt_idx" ON "Feed"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Feed_eventId_isPinned_pinOrder_idx" ON "Feed"("eventId", "isPinned", "pinOrder");

-- CreateIndex
CREATE INDEX "Feed_eventId_type_isPinned_idx" ON "Feed"("eventId", "type", "isPinned");

-- CreateIndex
CREATE INDEX "Feed_userId_isPinned_idx" ON "Feed"("userId", "isPinned");

-- CreateIndex
CREATE INDEX "Feed_createdAt_idx" ON "Feed"("createdAt");

-- CreateIndex
CREATE INDEX "HiddenFeed_userId_idx" ON "HiddenFeed"("userId");

-- CreateIndex
CREATE INDEX "HiddenFeed_feedId_idx" ON "HiddenFeed"("feedId");

-- AddForeignKey
ALTER TABLE "Feed" ADD CONSTRAINT "Feed_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feed" ADD CONSTRAINT "Feed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenFeed" ADD CONSTRAINT "HiddenFeed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenFeed" ADD CONSTRAINT "HiddenFeed_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "Feed"("id") ON DELETE CASCADE ON UPDATE CASCADE;

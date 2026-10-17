CREATE TYPE "ImpactReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "EventImpactReport" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "outcomes" JSONB NOT NULL DEFAULT '[]',
    "evidenceLinks" TEXT[],
    "status" "ImpactReportStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventImpactReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventImpactReport_eventId_key" ON "EventImpactReport"("eventId");
CREATE INDEX "EventImpactReport_creatorId_idx" ON "EventImpactReport"("creatorId");
CREATE INDEX "EventImpactReport_status_idx" ON "EventImpactReport"("status");
CREATE INDEX "EventImpactReport_publishedAt_idx" ON "EventImpactReport"("publishedAt");

ALTER TABLE "EventImpactReport" ADD CONSTRAINT "EventImpactReport_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventImpactReport" ADD CONSTRAINT "EventImpactReport_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

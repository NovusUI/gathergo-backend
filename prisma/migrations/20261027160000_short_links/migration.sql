CREATE TYPE "ShortLinkKind" AS ENUM ('event', 'foodbank', 'carpool');
CREATE TABLE "ShortLink" (
  "code" TEXT NOT NULL,
  "kind" "ShortLinkKind" NOT NULL,
  "targetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShortLink_pkey" PRIMARY KEY ("code")
);
CREATE UNIQUE INDEX "ShortLink_kind_targetId_key" ON "ShortLink"("kind", "targetId");

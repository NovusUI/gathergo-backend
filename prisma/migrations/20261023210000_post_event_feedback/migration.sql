CREATE TYPE "EventFeedbackRating" AS ENUM ('LOVED', 'OKAY', 'NOT_FOR_ME');
CREATE TABLE "EventFeedback" (
  "id" TEXT NOT NULL,
  "preferenceId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "rating" "EventFeedbackRating",
  "moreLikeThis" BOOLEAN NOT NULL DEFAULT false,
  "respondedAt" TIMESTAMP(3),
  "deferredUntil" TIMESTAMP(3),
  CONSTRAINT "EventFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventFeedback_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "UserPreference"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventFeedback_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventFeedback_preferenceId_eventId_key" ON "EventFeedback"("preferenceId", "eventId");

ALTER TABLE "events" ADD COLUMN "rescheduling_poll_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_rescheduling_poll_id_community_lineup_matches_id_fk"
  FOREIGN KEY ("rescheduling_poll_id") REFERENCES "community_lineup_matches"("id")
  ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "idx_events_rescheduling_poll_id"
  ON "events" ("rescheduling_poll_id")
  WHERE rescheduling_poll_id IS NOT NULL;
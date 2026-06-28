-- ROK-1352: drop the orphan event_series_settings table on any dev/fleet DB that
-- ran the original 0148 before the series mechanism was consolidated out. No-op on
-- fresh DBs (the table is never created). Manual edit — see commit message.
DROP TABLE IF EXISTS "event_series_settings";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ephemeral_voice_enabled" boolean;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ephemeral_voice_channel_id" text;--> statement-breakpoint
CREATE INDEX "idx_events_ephemeral_voice_channel_id" ON "events" USING btree ("ephemeral_voice_channel_id") WHERE "events"."ephemeral_voice_channel_id" IS NOT NULL;
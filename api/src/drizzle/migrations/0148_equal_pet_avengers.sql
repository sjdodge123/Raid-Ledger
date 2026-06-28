ALTER TABLE "events" ADD COLUMN "ephemeral_voice_enabled" boolean;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ephemeral_voice_channel_id" text;--> statement-breakpoint
CREATE INDEX "idx_events_ephemeral_voice_channel_id" ON "events" USING btree ("ephemeral_voice_channel_id") WHERE "events"."ephemeral_voice_channel_id" IS NOT NULL;
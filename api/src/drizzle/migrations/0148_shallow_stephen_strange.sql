CREATE TABLE "event_series_settings" (
	"recurrence_group_id" uuid PRIMARY KEY NOT NULL,
	"ephemeral_voice_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ephemeral_voice_enabled" boolean;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ephemeral_voice_channel_id" text;--> statement-breakpoint
CREATE INDEX "idx_events_ephemeral_voice_channel_id" ON "events" USING btree ("ephemeral_voice_channel_id") WHERE "events"."ephemeral_voice_channel_id" IS NOT NULL;
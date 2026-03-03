CREATE TABLE "enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" varchar(100) NOT NULL,
	"enricher_key" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_entity_enricher" UNIQUE("entity_type","entity_id","enricher_key")
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"member_returned":{"inApp":true,"push":true,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
CREATE INDEX "idx_enrichments_entity" ON "enrichments" USING btree ("entity_type","entity_id");
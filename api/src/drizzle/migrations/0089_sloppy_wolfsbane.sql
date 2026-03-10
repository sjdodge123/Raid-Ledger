ALTER TABLE "game_interests" DROP CONSTRAINT "uq_user_game_interest";--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"member_returned":{"inApp":true,"push":true,"discord":true},"recruitment_reminder":{"inApp":true,"push":true,"discord":true},"role_gap_alert":{"inApp":true,"push":true,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "steam_id" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "steam_app_id" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "itad_game_id" text;--> statement-breakpoint
ALTER TABLE "game_interests" ADD COLUMN "playtime_forever" integer;--> statement-breakpoint
ALTER TABLE "game_interests" ADD COLUMN "playtime_2weeks" integer;--> statement-breakpoint
ALTER TABLE "game_interests" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN "category" text DEFAULT 'Other' NOT NULL;--> statement-breakpoint
ALTER TABLE "discord_event_messages" ADD COLUMN "bump_message_id" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_event_signups_event_id_status" ON "event_signups" USING btree ("event_id","status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_steam_id_unique" UNIQUE("steam_id");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_itad_game_id_unique" UNIQUE("itad_game_id");--> statement-breakpoint
ALTER TABLE "game_interests" ADD CONSTRAINT "uq_user_game_interest_source" UNIQUE("user_id","game_id","source");
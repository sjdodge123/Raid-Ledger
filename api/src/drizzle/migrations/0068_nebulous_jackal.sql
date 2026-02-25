CREATE TABLE "game_activity_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer,
	"discord_activity_name" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "game_activity_rollups" (
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"period" varchar(10) NOT NULL,
	"period_start" date NOT NULL,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "game_activity_rollups_user_game_period_unique" UNIQUE("user_id","game_id","period","period_start")
);
--> statement-breakpoint
CREATE TABLE "discord_game_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_activity_name" text NOT NULL,
	"game_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discord_game_mappings_discord_activity_name_unique" UNIQUE("discord_activity_name")
);
--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "reminder_1hour" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "reminder_24hour" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":false,"discord":false},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
ALTER TABLE "event_plans" ALTER COLUMN "reminder_1hour" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "event_plans" ALTER COLUMN "reminder_24hour" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "preferred_roles" text[];--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "attendance_status" varchar(20);--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "attendance_recorded_at" timestamp;--> statement-breakpoint
ALTER TABLE "wow_classic_boss_loot" ADD COLUMN "item_subclass" varchar(50);--> statement-breakpoint
ALTER TABLE "game_activity_sessions" ADD CONSTRAINT "game_activity_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activity_sessions" ADD CONSTRAINT "game_activity_sessions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activity_rollups" ADD CONSTRAINT "game_activity_rollups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_activity_rollups" ADD CONSTRAINT "game_activity_rollups_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_game_mappings" ADD CONSTRAINT "discord_game_mappings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_activity_sessions_user_game_started_idx" ON "game_activity_sessions" USING btree ("user_id","game_id","started_at");--> statement-breakpoint
CREATE INDEX "game_activity_sessions_game_started_idx" ON "game_activity_sessions" USING btree ("game_id","started_at");--> statement-breakpoint
CREATE INDEX "game_activity_rollups_game_period_start_idx" ON "game_activity_rollups" USING btree ("game_id","period","period_start");
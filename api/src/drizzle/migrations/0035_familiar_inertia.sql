CREATE TABLE "feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"page_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":false,"discord":false},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true}}'::jsonb;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
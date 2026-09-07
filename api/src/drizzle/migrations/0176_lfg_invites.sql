CREATE TABLE "lfg_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"inviter_user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"declined_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"event_delayed":{"inApp":true,"push":true,"discord":true},"running_late":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"member_returned":{"inApp":true,"push":true,"discord":true},"recruitment_reminder":{"inApp":true,"push":true,"discord":true},"role_gap_alert":{"inApp":true,"push":true,"discord":true},"lineup_steam_nudge":{"inApp":true,"push":false,"discord":true},"community_lineup":{"inApp":true,"push":true,"discord":true},"user_deactivated_discord":{"inApp":true,"push":false,"discord":false},"user_reactivated_discord":{"inApp":true,"push":false,"discord":false},"post_event_followup":{"inApp":true,"push":false,"discord":true},"lfg_invite":{"inApp":true,"push":false,"discord":true},"lfg_player_invite":{"inApp":true,"push":false,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lfg_invites_recipient_sent_at" ON "lfg_invites" USING btree ("recipient_user_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_lfg_invites_game_sent_at" ON "lfg_invites" USING btree ("game_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_lfg_invites_recipient_game_sent_at" ON "lfg_invites" USING btree ("recipient_user_id","game_id","sent_at");
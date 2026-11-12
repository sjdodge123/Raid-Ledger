CREATE TABLE "gg_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"year" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"activity_tier" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"share_slug" text,
	"shared_at" timestamp with time zone,
	"dm_claimed_at" timestamp with time zone,
	"dm_sent_at" timestamp with time zone,
	CONSTRAINT "gg_snapshots_share_slug_unique" UNIQUE("share_slug"),
	CONSTRAINT "gg_snapshots_tier_chk" CHECK ("gg_snapshots"."activity_tier" IN ('short', 'full')),
	CONSTRAINT "gg_snapshots_share_pair_chk" CHECK (("gg_snapshots"."share_slug" IS NULL) = ("gg_snapshots"."shared_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"event_delayed":{"inApp":true,"push":true,"discord":true},"running_late":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"member_returned":{"inApp":true,"push":true,"discord":true},"recruitment_reminder":{"inApp":true,"push":true,"discord":true},"role_gap_alert":{"inApp":true,"push":true,"discord":true},"lineup_steam_nudge":{"inApp":true,"push":false,"discord":true},"community_lineup":{"inApp":true,"push":true,"discord":true},"user_deactivated_discord":{"inApp":true,"push":false,"discord":false},"user_reactivated_discord":{"inApp":true,"push":false,"discord":false},"post_event_followup":{"inApp":true,"push":false,"discord":true},"lfg_invite":{"inApp":true,"push":false,"discord":true},"lfg_player_invite":{"inApp":true,"push":false,"discord":true},"hub_leader_post":{"inApp":true,"push":false,"discord":true},"hub_event_tagged":{"inApp":true,"push":false,"discord":true},"hub_proposal_submitted":{"inApp":true,"push":false,"discord":true},"hub_proposal_reviewed":{"inApp":true,"push":false,"discord":true},"valheim_claim_suggestion":{"inApp":false,"push":false,"discord":true},"gg_ready":{"inApp":true,"push":false,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
ALTER TABLE "gg_snapshots" ADD CONSTRAINT "gg_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gg_snapshots_user_year_uq" ON "gg_snapshots" USING btree ("user_id","year");--> statement-breakpoint
CREATE INDEX "gg_snapshots_dm_pending_idx" ON "gg_snapshots" USING btree ("year") WHERE "gg_snapshots"."dm_claimed_at" IS NULL;
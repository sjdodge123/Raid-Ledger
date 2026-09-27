-- ROK-1693 — HAND-WRITTEN repair migration (`drizzle-kit generate --custom`;
-- no codegen, so the snapshot is unchanged and 0193_snapshot.json equals 0192).
--
-- Why it exists: Drizzle's migrator runs a journal entry only when its `when`
-- is greater than the newest applied `created_at`. 0176_lfg_invites
-- (when 1788754699835) merged AFTER 0177_thread_message_reactions
-- (when 1788777821097), so every database that had already applied 0177 —
-- production included — silently skipped 0176 and has no lfg_invites table.
-- 0174_lfg_intent_urgency merged after 0175 the same way; it is almost
-- certainly applied (0186 drops and re-adds its urgency CHECK, which would have
-- failed without it), but its DDL is re-applied here too so no install can be
-- left without it.
--
-- Every statement is idempotent and converges on the HEAD schema: a no-op on a
-- fresh database and on any database that ran 0176/0174. The urgency CHECK is
-- the CURRENT definition from 0186 (with 'tonight'), NOT 0174's — re-adding the
-- 0174 form would reject live rows. Self-contained: no app-side data needed.
--
-- The final block back-fills 0176's and 0174's rows in
-- drizzle.__drizzle_migrations (hash = sha256 of each file, created_at = its
-- journal `when`) when absent. The migrator never writes a row for a skipped
-- entry, so without this the restore drill's journal-hashes-present check
-- fails on every prod dump and the boot check counts prod as a partial apply.
-- Both `when`s are older than 0193's, so 0193 stays the newest row. The row
-- commits in the migrator's single transaction together with the DDL above.
-- The to_regclass guard is an OUTER IF on purpose: scripts/validate-migrations.sh
-- applies files through psql with no drizzle schema, and an IF condition that
-- names drizzle.__drizzle_migrations would fail to plan there.
CREATE TABLE IF NOT EXISTS "lfg_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"inviter_user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"declined_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"event_delayed":{"inApp":true,"push":true,"discord":true},"running_late":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"member_returned":{"inApp":true,"push":true,"discord":true},"recruitment_reminder":{"inApp":true,"push":true,"discord":true},"role_gap_alert":{"inApp":true,"push":true,"discord":true},"lineup_steam_nudge":{"inApp":true,"push":false,"discord":true},"community_lineup":{"inApp":true,"push":true,"discord":true},"user_deactivated_discord":{"inApp":true,"push":false,"discord":false},"user_reactivated_discord":{"inApp":true,"push":false,"discord":false},"post_event_followup":{"inApp":true,"push":false,"discord":true},"lfg_invite":{"inApp":true,"push":false,"discord":true},"lfg_player_invite":{"inApp":true,"push":false,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lfg_invites_recipient_user_id_users_id_fk' AND conrelid = 'public.lfg_invites'::regclass) THEN
    ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lfg_invites_inviter_user_id_users_id_fk' AND conrelid = 'public.lfg_invites'::regclass) THEN
    ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lfg_invites_game_id_games_id_fk' AND conrelid = 'public.lfg_invites'::regclass) THEN
    ALTER TABLE "lfg_invites" ADD CONSTRAINT "lfg_invites_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lfg_invites_recipient_sent_at" ON "lfg_invites" USING btree ("recipient_user_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lfg_invites_game_sent_at" ON "lfg_invites" USING btree ("game_id","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lfg_invites_recipient_game_sent_at" ON "lfg_invites" USING btree ("recipient_user_id","game_id","sent_at");--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD COLUMN IF NOT EXISTS "urgency" text DEFAULT 'week' NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD COLUMN IF NOT EXISTS "ttl_minutes" integer;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lfg_intents_urgency_check' AND conrelid = 'public.lfg_intents'::regclass) THEN
    ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_urgency_check" CHECK ("lfg_intents"."urgency" IN ('week', 'now', 'tonight'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lfg_intents_ttl_minutes_check' AND conrelid = 'public.lfg_intents'::regclass) THEN
    ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_ttl_minutes_check" CHECK ("lfg_intents"."ttl_minutes" IS NULL OR "lfg_intents"."ttl_minutes" IN (30, 60));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '4a31d8616170dce35514a0c7bd091ea79d0453d2f14ef4bc85d3a60e14c0b267') THEN
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('4a31d8616170dce35514a0c7bd091ea79d0453d2f14ef4bc85d3a60e14c0b267', 1788754699835); -- 0176_lfg_invites
    END IF;
    IF NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '8dd41f6edbbd43f863df3468ec47c176f66f301cd0f0c7cf8d021f498989363d') THEN
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('8dd41f6edbbd43f863df3468ec47c176f66f301cd0f0c7cf8d021f498989363d', 1788655926072); -- 0174_lfg_intent_urgency
    END IF;
  END IF;
END $$;

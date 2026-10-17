-- Hand-written migration: fixing phantom migration where tracking table shows
-- applied but DDL never executed. All statements are idempotent (IF NOT EXISTS /
-- EXCEPTION WHEN duplicate_object).

-- ============================================================
-- 1. community_lineups (base table from 0098)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineups" (
  "id" serial PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'building' NOT NULL,
  "target_date" timestamp,
  "decided_game_id" integer,
  "linked_event_id" integer,
  "created_by" integer NOT NULL,
  "voting_deadline" timestamp,
  "phase_deadline" timestamp,
  "phase_duration_override" jsonb,
  "match_threshold" integer NOT NULL DEFAULT 35,
  "max_votes_per_player" smallint NOT NULL DEFAULT 3,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- FKs for community_lineups
DO $$ BEGIN
  ALTER TABLE "community_lineups"
    ADD CONSTRAINT "community_lineups_decided_game_id_games_id_fk"
    FOREIGN KEY ("decided_game_id") REFERENCES "public"."games"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineups"
    ADD CONSTRAINT "community_lineups_linked_event_id_events_id_fk"
    FOREIGN KEY ("linked_event_id") REFERENCES "public"."events"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineups"
    ADD CONSTRAINT "community_lineups_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. community_lineup_entries (from 0098)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_entries" (
  "id" serial PRIMARY KEY NOT NULL,
  "lineup_id" integer NOT NULL,
  "game_id" integer NOT NULL,
  "nominated_by" integer NOT NULL,
  "note" text,
  "carried_over_from" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_entries"
    ADD CONSTRAINT "uq_lineup_entry_game" UNIQUE ("lineup_id", "game_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_entries"
    ADD CONSTRAINT "community_lineup_entries_lineup_id_community_lineups_id_fk"
    FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_entries"
    ADD CONSTRAINT "community_lineup_entries_game_id_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."games"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_entries"
    ADD CONSTRAINT "community_lineup_entries_nominated_by_users_id_fk"
    FOREIGN KEY ("nominated_by") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_entries"
    ADD CONSTRAINT "community_lineup_entries_carried_over_from_community_lineups_id_fk"
    FOREIGN KEY ("carried_over_from") REFERENCES "public"."community_lineups"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 3. community_lineup_votes (from 0098)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "lineup_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "game_id" integer NOT NULL,
  "rank" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_votes"
    ADD CONSTRAINT "uq_lineup_vote_user_game" UNIQUE ("lineup_id", "user_id", "game_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_votes"
    ADD CONSTRAINT "community_lineup_votes_lineup_id_community_lineups_id_fk"
    FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_votes"
    ADD CONSTRAINT "community_lineup_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_votes"
    ADD CONSTRAINT "community_lineup_votes_game_id_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."games"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 4. community_lineup_matches (from 0104, upgraded by 0105)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_matches" (
  "id" serial PRIMARY KEY NOT NULL,
  "lineup_id" integer NOT NULL,
  "game_id" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'suggested',
  "threshold_met" boolean NOT NULL DEFAULT false,
  "vote_count" integer NOT NULL DEFAULT 0,
  "vote_percentage" numeric(5, 2),
  "fit_type" text,
  "linked_event_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "uq_lineup_match_game" UNIQUE ("lineup_id", "game_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_lineup_id_community_lineups_id_fk"
    FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_game_id_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "public"."games"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_linked_event_id_events_id_fk"
    FOREIGN KEY ("linked_event_id") REFERENCES "public"."events"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 5. community_lineup_match_members (from 0104, upgraded by 0105)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_match_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "match_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "uq_match_member_user" UNIQUE ("match_id", "user_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "community_lineup_match_members_match_id_community_lineup_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "community_lineup_match_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 6. community_lineup_schedule_slots (from 0105)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_schedule_slots" (
  "id" serial PRIMARY KEY NOT NULL,
  "match_id" integer NOT NULL,
  "proposed_time" timestamp NOT NULL,
  "overlap_score" numeric(5, 2),
  "suggested_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_slots"
    ADD CONSTRAINT "community_lineup_schedule_slots_match_id_community_lineup_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 7. community_lineup_schedule_votes (from 0105)
-- ============================================================
CREATE TABLE IF NOT EXISTS "community_lineup_schedule_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "slot_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_votes"
    ADD CONSTRAINT "uq_schedule_vote_user" UNIQUE ("slot_id", "user_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_votes"
    ADD CONSTRAINT "community_lineup_schedule_votes_slot_id_community_lineup_schedule_slots_id_fk"
    FOREIGN KEY ("slot_id") REFERENCES "public"."community_lineup_schedule_slots"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_votes"
    ADD CONSTRAINT "community_lineup_schedule_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 8. Ensure columns added by later migrations exist
--    (covers case where base table exists but column migrations
--     from 0102/0103/0109 were also phantom)
-- ============================================================
ALTER TABLE "community_lineups" ADD COLUMN IF NOT EXISTS "phase_deadline" timestamp;
ALTER TABLE "community_lineups" ADD COLUMN IF NOT EXISTS "phase_duration_override" jsonb;
ALTER TABLE "community_lineups" ADD COLUMN IF NOT EXISTS "match_threshold" integer NOT NULL DEFAULT 35;
ALTER TABLE "community_lineups" ADD COLUMN IF NOT EXISTS "max_votes_per_player" smallint NOT NULL DEFAULT 3;

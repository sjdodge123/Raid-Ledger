-- ROK-964: Upgrade lineup match tables and add scheduling phase tables.
-- Migration 0104 (ROK-936) created community_lineup_matches and
-- community_lineup_match_members with a simpler schema. This migration
-- adds missing columns, renames columns to match the canonical Drizzle
-- schema, adds unique constraints, and creates schedule tables.

-- 1. Add missing columns to community_lineup_matches
ALTER TABLE "community_lineup_matches"
  ADD COLUMN IF NOT EXISTS "threshold_met" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "fit_type" text,
  ADD COLUMN IF NOT EXISTS "vote_percentage" numeric(5, 2),
  ADD COLUMN IF NOT EXISTS "linked_event_id" integer,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;

-- 2. Migrate data from old column names to new ones
UPDATE "community_lineup_matches"
  SET "vote_percentage" = "voter_percentage",
      "fit_type" = "fit_category"
  WHERE "vote_percentage" IS NULL AND "voter_percentage" IS NOT NULL;

-- 3. Drop old columns
ALTER TABLE "community_lineup_matches"
  DROP COLUMN IF EXISTS "voter_percentage",
  DROP COLUMN IF EXISTS "fit_category";

-- 4. Add unique constraints (idempotent)
DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "uq_lineup_match_game" UNIQUE ("lineup_id", "game_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "uq_match_member_user" UNIQUE ("match_id", "user_id");
EXCEPTION WHEN duplicate_table THEN null;
END $$;

-- 5. Add FK for linked_event_id
DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_linked_event_id_events_id_fk"
    FOREIGN KEY ("linked_event_id") REFERENCES "events"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 6. Create schedule tables (new)
CREATE TABLE IF NOT EXISTS "community_lineup_schedule_slots" (
  "id" serial PRIMARY KEY NOT NULL,
  "match_id" integer NOT NULL,
  "proposed_time" timestamp NOT NULL,
  "overlap_score" numeric(5, 2),
  "suggested_by" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "community_lineup_schedule_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "slot_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_schedule_vote_user" UNIQUE("slot_id", "user_id")
);

-- 7. Add FKs for schedule tables
DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_slots"
    ADD CONSTRAINT "community_lineup_schedule_slots_match_id_community_lineup_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "community_lineup_matches"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_votes"
    ADD CONSTRAINT "community_lineup_schedule_votes_slot_id_community_lineup_schedule_slots_id_fk"
    FOREIGN KEY ("slot_id") REFERENCES "community_lineup_schedule_slots"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_schedule_votes"
    ADD CONSTRAINT "community_lineup_schedule_votes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

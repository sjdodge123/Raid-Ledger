-- ROK-964: Lineup match groups and scheduling phase tables.
-- NOTE: community_lineups.status uses text (not pg enum), so adding
-- 'scheduling' requires no ALTER TYPE — Drizzle's check constraint
-- handles it at the application layer.
-- NOTE: match_threshold already exists from migration 0103.

CREATE TABLE IF NOT EXISTS "community_lineup_matches" (
  "id" serial PRIMARY KEY NOT NULL,
  "lineup_id" integer NOT NULL,
  "game_id" integer NOT NULL,
  "status" text DEFAULT 'suggested' NOT NULL,
  "threshold_met" boolean DEFAULT false NOT NULL,
  "vote_count" integer DEFAULT 0 NOT NULL,
  "vote_percentage" numeric(5, 2),
  "fit_type" text,
  "linked_event_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_lineup_match_game" UNIQUE("lineup_id", "game_id")
);

CREATE TABLE IF NOT EXISTS "community_lineup_match_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "match_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_match_member_user" UNIQUE("match_id", "user_id")
);

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

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_lineup_id_community_lineups_id_fk"
    FOREIGN KEY ("lineup_id") REFERENCES "community_lineups"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_game_id_games_id_fk"
    FOREIGN KEY ("game_id") REFERENCES "games"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_matches"
    ADD CONSTRAINT "community_lineup_matches_linked_event_id_events_id_fk"
    FOREIGN KEY ("linked_event_id") REFERENCES "events"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "community_lineup_match_members_match_id_community_lineup_matches_id_fk"
    FOREIGN KEY ("match_id") REFERENCES "community_lineup_matches"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "community_lineup_match_members"
    ADD CONSTRAINT "community_lineup_match_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

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

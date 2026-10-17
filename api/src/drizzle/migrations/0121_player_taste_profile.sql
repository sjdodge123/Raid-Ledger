-- ROK-948 PR 2: Player Taste Profile tables.
-- pgvector extension was enabled in migration 0120 (PR 1).

CREATE TABLE IF NOT EXISTS "player_taste_vectors" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "vector" vector(7) NOT NULL,
  "dimensions" jsonb NOT NULL,
  "intensity_metrics" jsonb NOT NULL,
  "archetype" text NOT NULL,
  "computed_at" timestamp DEFAULT now() NOT NULL,
  "signal_hash" text NOT NULL,
  CONSTRAINT "player_taste_vectors_user_id_unique" UNIQUE ("user_id")
);

CREATE INDEX IF NOT EXISTS "player_taste_vectors_computed_at_idx"
  ON "player_taste_vectors" ("computed_at");

CREATE TABLE IF NOT EXISTS "player_intensity_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "week_start" date NOT NULL,
  "total_hours" numeric(10, 2) NOT NULL,
  "game_breakdown" jsonb NOT NULL,
  "unique_games" integer NOT NULL,
  "longest_session_hours" numeric(10, 2) NOT NULL,
  "longest_session_game_id" integer REFERENCES "games"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "uq_player_intensity_user_week" UNIQUE ("user_id", "week_start")
);

CREATE INDEX IF NOT EXISTS "player_intensity_snapshots_week_start_idx"
  ON "player_intensity_snapshots" ("week_start");

CREATE TABLE IF NOT EXISTS "player_co_play" (
  "user_id_a" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "user_id_b" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_count" integer NOT NULL,
  "total_minutes" integer NOT NULL,
  "last_played_at" timestamp NOT NULL,
  "games_played" jsonb NOT NULL,
  CONSTRAINT "player_co_play_pk" PRIMARY KEY ("user_id_a", "user_id_b"),
  CONSTRAINT "chk_player_co_play_canonical_order" CHECK ("user_id_a" < "user_id_b")
);

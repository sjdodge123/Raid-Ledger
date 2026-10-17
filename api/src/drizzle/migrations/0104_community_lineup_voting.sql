-- ROK-936: Community lineup matching tables for voting → decided transition.
CREATE TABLE "community_lineup_matches" (
  "id" serial PRIMARY KEY,
  "lineup_id" integer NOT NULL REFERENCES "community_lineups"("id") ON DELETE CASCADE,
  "game_id" integer NOT NULL REFERENCES "games"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "vote_count" integer NOT NULL,
  "voter_percentage" numeric(5, 2) NOT NULL,
  "fit_category" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "community_lineup_match_members" (
  "id" serial PRIMARY KEY,
  "match_id" integer NOT NULL REFERENCES "community_lineup_matches"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

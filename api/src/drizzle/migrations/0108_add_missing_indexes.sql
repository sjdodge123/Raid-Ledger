-- ROK-879: Add missing database indexes for query performance.
-- Source: ROK-278 Hardening Audit (L-3, L-4, L-5).

-- L-3: Standalone index on event_types.game_id for filtering event types by game.
-- The unique constraint on (game_id, slug) does not help queries filtering by game_id alone.
CREATE INDEX IF NOT EXISTS "idx_event_types_game_id"
  ON "event_types" USING btree ("game_id");

-- L-4: Standalone index on game_interests.game_id for want-to-play count queries.
-- The unique constraint on (user_id, game_id, source) does not help queries filtering by game_id alone.
CREATE INDEX IF NOT EXISTS "idx_game_interests_game_id"
  ON "game_interests" USING btree ("game_id");

-- L-5: GiST index on availability.time_range for overlap queries (matchmaking).
-- Drizzle DSL cannot express GiST indexes natively, so this is managed here.
CREATE INDEX IF NOT EXISTS "idx_availability_time_range_gist"
  ON "availability" USING gist ("time_range");

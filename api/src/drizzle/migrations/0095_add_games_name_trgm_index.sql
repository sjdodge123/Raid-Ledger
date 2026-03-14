-- ROK-750: Add GIN trigram index on games.name to speed up ILIKE searches.
-- The /games/search endpoint uses ILIKE('%word%') pattern matching via
-- buildWordMatchFilters(). Without a GIN trigram index, PostgreSQL must
-- sequentially scan the games table for every ILIKE predicate.
-- Depends on pg_trgm extension (enabled in migration 0086).
CREATE INDEX IF NOT EXISTS "idx_games_name_trgm"
  ON "games" USING GIN ("name" gin_trgm_ops);

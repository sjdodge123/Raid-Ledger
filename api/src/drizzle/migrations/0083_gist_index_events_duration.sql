-- ROK-703: Add GiST index on events.duration for tsrange overlap queries.
-- The game-time composite view uses `events.duration && tsrange` to find
-- events overlapping a given week. Without a GiST index, PostgreSQL must
-- sequentially scan the events table for every overlap check.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_events_duration_gist"
  ON "events" USING gist ("duration");

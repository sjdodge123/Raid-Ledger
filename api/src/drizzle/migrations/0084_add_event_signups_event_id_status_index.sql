-- ROK-704: Composite index for roster queries that filter by event_id + status.
-- Many queries (roster fetch, signup counts, embed sync) filter on both columns.
CREATE INDEX IF NOT EXISTS "idx_event_signups_event_id_status" ON "event_signups" USING btree ("event_id", "status");

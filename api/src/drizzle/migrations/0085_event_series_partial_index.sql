-- ROK-429: Upgrade recurrence_group_id index to partial index.
-- Only rows with a non-null recurrence_group_id need indexing.
DROP INDEX IF EXISTS "idx_events_recurrence_group_id";
CREATE INDEX "idx_events_recurrence_group_id" ON "events" ("recurrence_group_id") WHERE recurrence_group_id IS NOT NULL;

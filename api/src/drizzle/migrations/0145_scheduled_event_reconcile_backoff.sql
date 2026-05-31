-- ROK-1332: Add per-event reconcile backoff column so the Discord-scheduled-event
-- reconciliation cron can pause retries on rows whose previous attempt hit the
-- guild-wide 100-SE cap (Discord error code 30038). Without this, 5 stuck events
-- × 1 cron run per 15min × 24h = 480 30038 errors/day forever once the cap is hit.
--
-- Partial index: most rows are NULL (no backoff active). The reconciliation cron
-- query joins on `IS NULL OR <= NOW()` so only the NOT-NULL branch needs the
-- index. Drizzle DSL doesn't support partial indexes natively — the schema
-- declaration is a plain index() and this migration hand-edits the CREATE INDEX
-- to add the partial predicate (matches precedent in migration 0085).
ALTER TABLE "events" ADD COLUMN "scheduled_event_reconcile_backoff_until" timestamp;--> statement-breakpoint
CREATE INDEX "idx_events_se_reconcile_backoff" ON "events" USING btree ("scheduled_event_reconcile_backoff_until") WHERE scheduled_event_reconcile_backoff_until IS NOT NULL;

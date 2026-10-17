-- ROK-1192: Backfill phase_deadline for active standalone scheduling polls.
--
-- Pre-ROK-1192 standalone polls were created without a deadline if the
-- caller omitted `durationHours`. The new reminder cron + archive
-- reconciler both require a non-null phase_deadline, so we set existing
-- decided standalone rows to created_at + 36h (midpoint between the
-- 24h-min and 72h-default of the new picker).
UPDATE community_lineups
SET phase_deadline = created_at + interval '36 hours'
WHERE status = 'decided'
  AND phase_duration_override->>'standalone' = 'true'
  AND phase_deadline IS NULL;

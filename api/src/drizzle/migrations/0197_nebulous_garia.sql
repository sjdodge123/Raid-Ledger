-- TDB:1980 — the remaining zone-less `timestamp` columns on community_lineups,
-- community_lineup_matches and community_lineup_match_members become
-- `timestamptz`, following 0194 (TDB:1489, proposed_time). Drizzle's generated
-- `SET DATA TYPE` has no USING clause, which would reinterpret every stored
-- value in the session TimeZone and shift it by that zone's offset on any
-- non-UTC database. Each statement below therefore pins the conversion with
-- `USING "<col>" AT TIME ZONE 'UTC'` (hand-added; drizzle-kit omits USING).
--
-- Why 'UTC' is the zone the values were written in:
--   * The 11 community_lineups columns are written only from JS Dates. Drizzle
--     serialises a Date as `toISOString()` (a UTC wall clock) and Postgres
--     dropped the `Z`, so `AT TIME ZONE 'UTC'` is exact for them.
--   * community_lineup_matches.threshold_notified_at is stamped by SQL `NOW()`
--     (SchedulingThresholdService.stampNotified) and
--     community_lineup_match_members.scheduling_submitted_at by
--     `COALESCE(..., now())` (scheduling-submitted-at.helpers.ts). Those hold
--     the SESSION TimeZone wall clock; prod and fleet Postgres run in UTC, so
--     'UTC' is the correct zone for them too.
--
-- Each ALTER TYPE rewrites its table under an ACCESS EXCLUSIVE lock. All three
-- tables are small (one row per lineup / match / match member), so the lock is
-- brief.
ALTER TABLE "community_lineups" ALTER COLUMN "target_date" SET DATA TYPE timestamp with time zone USING "target_date" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "voting_deadline" SET DATA TYPE timestamp with time zone USING "voting_deadline" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "phase_deadline" SET DATA TYPE timestamp with time zone USING "phase_deadline" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "auto_advance_paused_at" SET DATA TYPE timestamp with time zone USING "auto_advance_paused_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "pending_advance_at" SET DATA TYPE timestamp with time zone USING "pending_advance_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "nomination_target_below_seen_at" SET DATA TYPE timestamp with time zone USING "nomination_target_below_seen_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "nomination_target_disarmed_at" SET DATA TYPE timestamp with time zone USING "nomination_target_disarmed_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "tie_detected_at" SET DATA TYPE timestamp with time zone USING "tie_detected_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "tie_expires_at" SET DATA TYPE timestamp with time zone USING "tie_expires_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "tie_expired_at" SET DATA TYPE timestamp with time zone USING "tie_expired_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "tie_pick_at" SET DATA TYPE timestamp with time zone USING "tie_pick_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" ALTER COLUMN "scheduling_submitted_at" SET DATA TYPE timestamp with time zone USING "scheduling_submitted_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ALTER COLUMN "threshold_notified_at" SET DATA TYPE timestamp with time zone USING "threshold_notified_at" AT TIME ZONE 'UTC';
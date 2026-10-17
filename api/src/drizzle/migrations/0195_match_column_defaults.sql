-- TDB:489 — HAND-WRITTEN migration (`drizzle-kit generate --custom`; no codegen,
-- so 0195_snapshot.json equals 0194 apart from id/prevId).
--
-- Why it exists: the Drizzle schema (schema/community-lineup-matches.ts) and
-- every snapshot already carry `.default('suggested')` / `.default(false)` /
-- `.default(0)` on these columns, so a plain `drizzle-kit generate` sees no
-- drift and emits nothing. The live columns, however, came from
-- 0104_community_lineup_voting, which created `status` and `vote_count` as
-- NOT NULL with NO default; 0113's restatement (which has the defaults) sits
-- behind CREATE TABLE IF NOT EXISTS and never fires where 0104 ran. Drizzle
-- emits the literal DEFAULT keyword for a `.default()` column the caller
-- omits, so such an insert fails with a not-null violation on "status".
-- threshold_met already got DEFAULT false from 0105's ADD COLUMN IF NOT EXISTS
-- on those databases; it is restated so the three columns are defined in one
-- place whatever path a database took.
--
-- SET DEFAULT is idempotent and touches no existing rows (all three columns
-- are NOT NULL, so there are no NULLs to back-fill). Self-contained.
ALTER TABLE "community_lineup_matches" ALTER COLUMN "status" SET DEFAULT 'suggested';--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ALTER COLUMN "threshold_met" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ALTER COLUMN "vote_count" SET DEFAULT 0;

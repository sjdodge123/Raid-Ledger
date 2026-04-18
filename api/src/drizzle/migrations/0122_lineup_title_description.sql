-- ROK-1063 — feat: lineup title & description
--
-- Adds `title` (VARCHAR(100) NOT NULL) and `description` (TEXT NULL) to
-- community_lineups. Existing rows (dev/staging — no prod data) are
-- backfilled with `Lineup — {Month YYYY}` based on created_at before the
-- NOT NULL constraint is applied.
--
-- Hand-edited after drizzle-kit generate to include the backfill step
-- (codegen emits the column as NOT NULL directly, which would fail on
-- any table that already has rows).
ALTER TABLE "community_lineups" ADD COLUMN "title" varchar(100);--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "description" text;--> statement-breakpoint
UPDATE "community_lineups"
  SET "title" = 'Lineup — ' || to_char("created_at", 'FMMonth YYYY')
  WHERE "title" IS NULL;--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "title" SET NOT NULL;

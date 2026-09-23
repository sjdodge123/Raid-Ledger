ALTER TABLE "community_lineup_schedule_votes" ADD COLUMN "stance" text DEFAULT 'yes' NOT NULL;
--> statement-breakpoint
-- ROK-1617: hand-added CHECK. Drizzle's `text({ enum })` is a TYPE-level
-- constraint only and emits no DB-level check, so without this the column
-- would accept any string and AC1's 'yes'/'no' guarantee would live solely in
-- TypeScript. Existing rows are all the DEFAULT 'yes', so the constraint
-- validates immediately.
ALTER TABLE "community_lineup_schedule_votes" ADD CONSTRAINT "cl_schedule_votes_stance_check" CHECK ("stance" IN ('yes', 'no'));

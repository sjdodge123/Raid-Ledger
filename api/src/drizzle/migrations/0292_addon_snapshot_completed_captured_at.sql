ALTER TABLE "character_addon_snapshots" ADD COLUMN "completed_captured_at" timestamp with time zone;--> statement-breakpoint
-- ROK-2144 D3 (hand-appended): backfill the completed list's capture time from captured_at for rows that hold a completed list. Self-contained; rows carried by a log-only export since ROK-2125 keep the newer time until the next full export (operator ruling Q4).
UPDATE "character_addon_snapshots" SET "completed_captured_at" = "captured_at" WHERE "section" = 'char' AND jsonb_typeof("data" -> 'quests' -> 'completed') = 'array';

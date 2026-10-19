-- ROK-1842: trim game-time absences the old contract let through. The
-- contract now caps an absence at 366 days (inclusive) inside
-- 2000-01-01..2100-12-31; rows stored before that (e.g. 0001-01-01 ..
-- 9999-12-31) are brought inside the same bounds. Self-contained: pure SQL
-- over game_time_absences, no app-side data needed.
--
-- 1. Clamp both dates into the window.
UPDATE "game_time_absences"
SET "start_date" = GREATEST("start_date", DATE '2000-01-01'),
    "end_date" = LEAST("end_date", DATE '2100-12-31'),
    "updated_at" = now()
WHERE "start_date" < DATE '2000-01-01' OR "end_date" > DATE '2100-12-31';
--> statement-breakpoint
-- 2. A row lying wholly outside the window is now inverted: remove it.
DELETE FROM "game_time_absences" WHERE "end_date" < "start_date";
--> statement-breakpoint
-- 3. Cap the span at 366 days inclusive, keeping the start date.
UPDATE "game_time_absences"
SET "end_date" = "start_date" + 365,
    "updated_at" = now()
WHERE "end_date" - "start_date" > 365;

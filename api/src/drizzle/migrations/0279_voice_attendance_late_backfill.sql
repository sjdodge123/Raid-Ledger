-- ROK-1940 (D5): voice-derived history backfill for "short late joiners count as late".
-- Custom migration (drizzle-kit generate --custom). Self-contained: pure SQL over
-- event_signups / event_voice_sessions / events, no app-side data.
-- Grace is hard-coded to 5 minutes (D4): app_settings.encrypted_value is encrypted
-- at rest, and no writer of voice_attendance_grace_minutes existed before ROK-1940,
-- so every past classification used the default 5.
-- Idempotent: a second run changes nothing.

-- S1 provenance: a recorded mark that some classified voice row collapses to
-- (no_show -> no_show, anything else -> attended) is voice-derived; any other mark
-- was set by hand. Known blind spot (D6, accepted Q2): a hand mark equal to the
-- voice mark is recorded as 'voice'.
UPDATE "event_signups" AS es
SET "attendance_source" = CASE
  WHEN EXISTS (
    SELECT 1
    FROM "event_voice_sessions" AS v
    WHERE v."event_id" = es."event_id"
      AND (v."discord_user_id" = es."discord_user_id" OR v."user_id" = es."user_id")
      AND v."classification" IS NOT NULL
      AND CASE WHEN v."classification" = 'no_show' THEN 'no_show' ELSE 'attended' END
        = es."attendance_status"
  ) THEN 'voice'
  ELSE 'manual'
END
WHERE es."attendance_status" IS NOT NULL
  AND es."attendance_source" IS NULL;
--> statement-breakpoint
-- S2 voice rows: a stored no_show with >= 120 s in voice can only have come from the
-- classifier's final fallback (presence < 20%). If its first join was after start +
-- grace, the new classifier labels it late. Relabels every eligible row, matched to a
-- signup or not, exactly as the live classifier does.
UPDATE "event_voice_sessions" AS v
SET "classification" = 'late'
FROM "events" AS e
WHERE e."id" = v."event_id"
  AND v."classification" = 'no_show'
  AND v."total_duration_sec" >= 120
  AND v."first_join_at" > lower(e."duration") + interval '5 minutes'
  AND upper(e."duration") > lower(e."duration");
--> statement-breakpoint
-- S3 signups: only a voice-derived no_show follows its voice row to attended
-- (late counts as attended — ROK-1938). Hand marks are never overwritten.
-- attendance_recorded_at is left as is.
UPDATE "event_signups" AS es
SET "attendance_status" = 'attended'
WHERE es."attendance_status" = 'no_show'
  AND es."attendance_source" = 'voice'
  AND EXISTS (
    SELECT 1
    FROM "event_voice_sessions" AS v
    WHERE v."event_id" = es."event_id"
      AND v."classification" = 'late'
      AND (v."discord_user_id" = es."discord_user_id" OR v."user_id" = es."user_id")
  );

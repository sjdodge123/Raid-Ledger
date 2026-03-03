ALTER TABLE "user_notification_preferences" ALTER COLUMN "channel_prefs" SET DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":true,"discord":true},"event_rescheduled":{"inApp":true,"push":true,"discord":true},"bench_promoted":{"inApp":true,"push":true,"discord":true},"event_cancelled":{"inApp":true,"push":true,"discord":true},"roster_reassigned":{"inApp":true,"push":true,"discord":true},"tentative_displaced":{"inApp":true,"push":true,"discord":true},"system":{"inApp":true,"push":false,"discord":false}}'::jsonb;
--> statement-breakpoint
-- Enable discord + push for missed_event_nudge on existing rows (ROK-588)
UPDATE "user_notification_preferences"
SET "channel_prefs" = jsonb_set(
  jsonb_set("channel_prefs", '{missed_event_nudge,discord}', 'true'),
  '{missed_event_nudge,push}', 'true'
)
WHERE "channel_prefs"->'missed_event_nudge'->>'discord' = 'false';
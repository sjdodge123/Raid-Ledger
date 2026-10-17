-- ROK-179: Replace flat boolean columns with JSONB channelPrefs matrix
-- Migrate existing boolean preferences to JSONB, then drop old columns

-- Step 1: Add the new JSONB column with a default
ALTER TABLE "user_notification_preferences"
  ADD COLUMN "channel_prefs" jsonb
  DEFAULT '{"slot_vacated":{"inApp":true,"push":true,"discord":true},"event_reminder":{"inApp":true,"push":true,"discord":true},"new_event":{"inApp":true,"push":true,"discord":true},"subscribed_game":{"inApp":true,"push":true,"discord":true},"achievement_unlocked":{"inApp":true,"push":false,"discord":false},"level_up":{"inApp":true,"push":false,"discord":false},"missed_event_nudge":{"inApp":true,"push":false,"discord":false}}'::jsonb
  NOT NULL;

-- Step 2: Migrate existing user preferences into the JSONB column
UPDATE "user_notification_preferences"
SET "channel_prefs" = jsonb_build_object(
  'slot_vacated', jsonb_build_object('inApp', "in_app_enabled" AND "slot_vacated", 'push', "slot_vacated", 'discord', "slot_vacated"),
  'event_reminder', jsonb_build_object('inApp', "in_app_enabled" AND "event_reminders", 'push', "event_reminders", 'discord', "event_reminders"),
  'new_event', jsonb_build_object('inApp', "in_app_enabled" AND "new_events", 'push', "new_events", 'discord', "new_events"),
  'subscribed_game', jsonb_build_object('inApp', "in_app_enabled" AND "subscribed_games", 'push', "subscribed_games", 'discord', "subscribed_games"),
  'achievement_unlocked', jsonb_build_object('inApp', true, 'push', false, 'discord', false),
  'level_up', jsonb_build_object('inApp', true, 'push', false, 'discord', false),
  'missed_event_nudge', jsonb_build_object('inApp', true, 'push', false, 'discord', false)
);

-- Step 3: Drop old boolean columns
ALTER TABLE "user_notification_preferences" DROP COLUMN "in_app_enabled";
ALTER TABLE "user_notification_preferences" DROP COLUMN "slot_vacated";
ALTER TABLE "user_notification_preferences" DROP COLUMN "event_reminders";
ALTER TABLE "user_notification_preferences" DROP COLUMN "new_events";
ALTER TABLE "user_notification_preferences" DROP COLUMN "subscribed_games";

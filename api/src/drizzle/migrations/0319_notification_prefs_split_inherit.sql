-- ROK-2311 (operator ruling Q9): the split notification types inherit the
-- switches of the row they used to live under, so nobody's experience changes
-- on release day:
--   community_lineup -> scheduling_poll
--   community_lineup -> lineup_lfg_offer (in-app only; the whole entry is copied)
--   slot_vacated     -> voice_access_lost
-- Each copy runs only when the row is a JSON object, the source entry is an
-- object and the target key is absent. Rows without the source key keep
-- resolving the new type to its default. `->` and `?` never raise on a
-- non-object, and the SET only runs on rows the WHERE admits. Idempotent.
UPDATE "user_notification_preferences"
SET "channel_prefs" = "channel_prefs"
  || jsonb_build_object('scheduling_poll', "channel_prefs" -> 'community_lineup')
WHERE jsonb_typeof("channel_prefs") = 'object'
  AND jsonb_typeof("channel_prefs" -> 'community_lineup') = 'object'
  AND NOT ("channel_prefs" ? 'scheduling_poll');
--> statement-breakpoint
UPDATE "user_notification_preferences"
SET "channel_prefs" = "channel_prefs"
  || jsonb_build_object('lineup_lfg_offer', "channel_prefs" -> 'community_lineup')
WHERE jsonb_typeof("channel_prefs") = 'object'
  AND jsonb_typeof("channel_prefs" -> 'community_lineup') = 'object'
  AND NOT ("channel_prefs" ? 'lineup_lfg_offer');
--> statement-breakpoint
UPDATE "user_notification_preferences"
SET "channel_prefs" = "channel_prefs"
  || jsonb_build_object('voice_access_lost', "channel_prefs" -> 'slot_vacated')
WHERE jsonb_typeof("channel_prefs") = 'object'
  AND jsonb_typeof("channel_prefs" -> 'slot_vacated') = 'object'
  AND NOT ("channel_prefs" ? 'voice_access_lost');

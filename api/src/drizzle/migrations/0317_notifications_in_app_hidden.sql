ALTER TABLE "notifications" ADD COLUMN "in_app_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ROK-2290 (operator ruling 2026-11-23, "migrate switches"): hand-appended
-- data step. Until now the bell switch silenced Discord too, so a member who
-- muted a bell got nothing for that type. From this release the bell switch
-- only hides the bell row and the DM still goes. To keep those members'
-- experience unchanged, turn the Discord switch OFF for every stored type
-- entry whose bell is OFF and whose Discord is effectively ON: stored
-- `discord: true`, or `discord` absent where the type's default is on
-- (defaults inlined from DEFAULT_CHANNEL_PREFS so this stays self-contained).
-- A type missing from the row resolves to its default bell ON, so it never
-- matches. valheim_claim_suggestion is excluded: it was always a DM-only type.
-- post_event_followup is excluded too (Lead ruling 2026-11-23, review MAJOR):
-- the organizer prompt is a direct DM gated only on its Discord switch, so an
-- organizer with that bell off gets it today; flipping Discord would stop it.
-- Other keys of an entry, other types and other rows are left untouched.
-- AND does not fix evaluation order and jsonb_each raises on a non-object, so
-- every jsonb_each argument and the per-entry rewrite are guarded by CASE.
UPDATE "user_notification_preferences" AS p
SET "channel_prefs" = (
  SELECT jsonb_object_agg(
    e.key,
    CASE
      WHEN jsonb_typeof(e.value) <> 'object' THEN e.value
      WHEN e.key IN (
          'slot_vacated', 'event_reminder', 'new_event', 'subscribed_game',
          'achievement_unlocked', 'level_up', 'missed_event_nudge',
          'event_rescheduled', 'event_delayed', 'running_late',
          'bench_promoted', 'event_cancelled', 'roster_reassigned',
          'tentative_displaced', 'member_returned', 'recruitment_reminder',
          'role_gap_alert', 'lineup_steam_nudge', 'community_lineup',
          'user_deactivated_discord', 'user_reactivated_discord',
          'lfg_invite', 'lfg_player_invite',
          'hub_leader_post', 'hub_event_tagged', 'hub_proposal_submitted',
          'hub_proposal_reviewed', 'gg_ready', 'calendar_needs_reconnect',
          'system')
        AND jsonb_typeof(e.value) = 'object'
        AND e.value -> 'inApp' = 'false'::jsonb
        AND (
          e.value -> 'discord' = 'true'::jsonb
          OR (
            NOT (e.value ? 'discord')
            AND e.key NOT IN (
              'achievement_unlocked', 'level_up', 'user_deactivated_discord',
              'user_reactivated_discord', 'system')
          )
        )
      THEN e.value || '{"discord": false}'::jsonb
      ELSE e.value
    END
  )
  FROM jsonb_each(CASE WHEN jsonb_typeof(p."channel_prefs") = 'object'
    THEN p."channel_prefs" ELSE '{}'::jsonb END) AS e
)
WHERE jsonb_typeof(p."channel_prefs") = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each(CASE WHEN jsonb_typeof(p."channel_prefs") = 'object'
    THEN p."channel_prefs" ELSE '{}'::jsonb END) AS m
    WHERE m.key NOT IN ('valheim_claim_suggestion', 'post_event_followup')
      AND jsonb_typeof(m.value) = 'object'
      AND m.value -> 'inApp' = 'false'::jsonb
      AND (
        m.value -> 'discord' = 'true'::jsonb
        OR (
          NOT (m.value ? 'discord')
          AND m.key NOT IN (
            'achievement_unlocked', 'level_up', 'user_deactivated_discord',
            'user_reactivated_discord', 'system')
        )
      )
  );

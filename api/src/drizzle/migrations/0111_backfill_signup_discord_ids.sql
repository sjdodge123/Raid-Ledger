-- ROK-985: Backfill discordUserId on event_signups from linked users.
-- The NOT EXISTS clause prevents unique constraint violation (unique_event_discord_user)
-- when a user has both a web signup and anonymous Discord signup for the same event.
UPDATE event_signups
SET discord_user_id = u.discord_id
FROM users u
WHERE event_signups.user_id = u.id
  AND event_signups.discord_user_id IS NULL
  AND u.discord_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM event_signups es2
    WHERE es2.event_id = event_signups.event_id
      AND es2.discord_user_id = u.discord_id
  );

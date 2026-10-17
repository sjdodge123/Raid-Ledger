-- Fix WoW Classic game row which was seeded with wrong igdbId (136210).
-- The correct IGDB ID for World of Warcraft Classic is 75379.
-- IGDB sync may have created a separate row with the correct igdbId.
-- This migration merges data and corrects the mapping.

-- The seeded row can be identified by igdb_id IN (136210, 25588) —
-- 136210 is the original seed value, 25588 was a manual fix attempt.
-- On any given environment, one of these will match.

-- Step 1: Move game_interests from the correct-igdb duplicate to the seeded row
INSERT INTO game_interests (user_id, game_id, source, playtime_forever, playtime_2weeks, last_synced_at, created_at)
SELECT gi.user_id, seeded.id, gi.source, gi.playtime_forever, gi.playtime_2weeks, gi.last_synced_at, gi.created_at
FROM games seeded
JOIN games dup ON dup.igdb_id = 75379 AND dup.id != seeded.id
JOIN game_interests gi ON gi.game_id = dup.id
WHERE seeded.igdb_id IN (136210, 25588)
ON CONFLICT DO NOTHING;

-- Step 2: Move game_activity_rollups from duplicate to seeded row
INSERT INTO game_activity_rollups (user_id, game_id, period, period_start, total_seconds)
SELECT gar.user_id, seeded.id, gar.period, gar.period_start, gar.total_seconds
FROM games seeded
JOIN games dup ON dup.igdb_id = 75379 AND dup.id != seeded.id
JOIN game_activity_rollups gar ON gar.game_id = dup.id
WHERE seeded.igdb_id IN (136210, 25588)
ON CONFLICT DO NOTHING;

-- Step 3: Delete the duplicate row with igdb_id=75379
-- (only if a separate seeded row exists with the wrong igdb_id)
DELETE FROM games
WHERE igdb_id = 75379
  AND EXISTS (SELECT 1 FROM games WHERE igdb_id IN (136210, 25588));

-- Step 4: Set the correct igdbId on the seeded row
UPDATE games SET igdb_id = 75379 WHERE igdb_id IN (136210, 25588);

-- Step 5: Restore twitchGameId if IGDB sync nulled it out
-- (IGDB doesn't have a Twitch external_game for WoW Classic)
UPDATE games SET twitch_game_id = '18122'
WHERE igdb_id = 75379 AND twitch_game_id IS NULL;

-- After this migration, the next IGDB sync will refresh the row with correct
-- World of Warcraft Classic metadata (name, slug, cover, etc.).

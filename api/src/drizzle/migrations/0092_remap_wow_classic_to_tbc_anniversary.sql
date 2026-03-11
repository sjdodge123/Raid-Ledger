-- ROK-789: Remap existing data from generic "WoW Classic" game to TBC Anniversary Edition.
--
-- The generic "World of Warcraft Classic" (slug: world-of-warcraft-classic) is not specific
-- enough — all existing data actually corresponds to TBC Anniversary Edition
-- (slug: world-of-warcraft-burning-crusade-classic-anniversary-edition).
--
-- This is a DATA-ONLY migration — no schema changes.
--
-- Production data (from ROK-786 audit):
--   characters: 8, events: 14, game_interests: 6,
--   game_activity_sessions: 48, game_activity_rollups: 47
--
-- ROLLBACK STRATEGY:
--   Reverse the direction — swap the two slugs in each statement:
--     UPDATE characters
--     SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
--     WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition');
--   Repeat for events, game_interests, game_activity_sessions, game_activity_rollups.
--   (No delete needed since the forward migration guards against conflicts.)

-- ============================================================================
-- 1. characters (unique on user_id + game_id + name + realm)
--    Also has partial unique index on (user_id, game_id) WHERE is_main = true.
--    Safety: skip rows that would conflict with existing TBC Anniversary data.
-- ============================================================================
UPDATE characters
SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND NOT EXISTS (
    SELECT 1 FROM characters c2
    WHERE c2.user_id = characters.user_id
      AND c2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND c2.name = characters.name
      AND c2.realm IS NOT DISTINCT FROM characters.realm
  );

-- Delete orphaned characters that could not be moved (duplicate already exists on target)
DELETE FROM characters
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND EXISTS (
    SELECT 1 FROM characters c2
    WHERE c2.user_id = characters.user_id
      AND c2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND c2.name = characters.name
      AND c2.realm IS NOT DISTINCT FROM characters.realm
  );

-- ============================================================================
-- 2. events (no unique constraint on game_id — simple UPDATE)
-- ============================================================================
UPDATE events
SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic');

-- ============================================================================
-- 3. game_interests (unique on user_id + game_id + source)
--    Safety: skip rows that would conflict with existing TBC Anniversary data.
-- ============================================================================
UPDATE game_interests
SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND NOT EXISTS (
    SELECT 1 FROM game_interests gi2
    WHERE gi2.user_id = game_interests.user_id
      AND gi2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND gi2.source = game_interests.source
  );

-- Delete orphaned game_interests that could not be moved
DELETE FROM game_interests
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND EXISTS (
    SELECT 1 FROM game_interests gi2
    WHERE gi2.user_id = game_interests.user_id
      AND gi2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND gi2.source = game_interests.source
  );

-- ============================================================================
-- 4. game_activity_sessions (no unique constraint on game_id — simple UPDATE)
-- ============================================================================
UPDATE game_activity_sessions
SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic');

-- ============================================================================
-- 5. game_activity_rollups (unique on user_id + game_id + period + period_start)
--    Safety: skip rows that would conflict with existing TBC Anniversary data.
-- ============================================================================
UPDATE game_activity_rollups
SET game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND NOT EXISTS (
    SELECT 1 FROM game_activity_rollups gar2
    WHERE gar2.user_id = game_activity_rollups.user_id
      AND gar2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND gar2.period = game_activity_rollups.period
      AND gar2.period_start = game_activity_rollups.period_start
  );

-- Delete orphaned game_activity_rollups that could not be moved
DELETE FROM game_activity_rollups
WHERE game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic')
  AND EXISTS (
    SELECT 1 FROM game_activity_rollups gar2
    WHERE gar2.user_id = game_activity_rollups.user_id
      AND gar2.game_id = (SELECT id FROM games WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition')
      AND gar2.period = game_activity_rollups.period
      AND gar2.period_start = game_activity_rollups.period_start
  );

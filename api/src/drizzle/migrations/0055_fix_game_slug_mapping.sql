-- ROK-400: Fix game slug mapping — resolve missing artwork
-- Migration 0054 matched game_registry to games by exact slug, but:
--   game_registry.slug='wow' != games.slug='world-of-warcraft' (IGDB ID 1)
--   game_registry.slug='wow-classic' != games.slug='world-of-warcraft-classic' (IGDB ID 2)
--   game_registry.slug='ffxiv' != games.slug='final-fantasy-xiv-online' (IGDB ID 3)
-- This caused duplicate rows (5964, 5965, 5966) with dead Blizzard asset URLs.
-- This migration fixes the data in place.

-- Step 1: Copy config columns from duplicate rows to correct IGDB rows
-- wow (5964) -> world-of-warcraft (1)
UPDATE "games"
SET
  "short_name" = dup."short_name",
  "color_hex" = dup."color_hex",
  "has_roles" = dup."has_roles",
  "has_specs" = dup."has_specs",
  "enabled" = dup."enabled",
  "max_characters_per_user" = dup."max_characters_per_user"
FROM "games" dup
WHERE "games"."slug" = 'world-of-warcraft'
  AND dup."slug" = 'wow';

-- wow-classic (5965) -> world-of-warcraft-classic (2)
UPDATE "games"
SET
  "short_name" = dup."short_name",
  "color_hex" = dup."color_hex",
  "has_roles" = dup."has_roles",
  "has_specs" = dup."has_specs",
  "enabled" = dup."enabled",
  "max_characters_per_user" = dup."max_characters_per_user"
FROM "games" dup
WHERE "games"."slug" = 'world-of-warcraft-classic'
  AND dup."slug" = 'wow-classic';

-- ffxiv (5966) -> final-fantasy-xiv-online (3)
UPDATE "games"
SET
  "short_name" = dup."short_name",
  "color_hex" = dup."color_hex",
  "has_roles" = dup."has_roles",
  "has_specs" = dup."has_specs",
  "enabled" = dup."enabled",
  "max_characters_per_user" = dup."max_characters_per_user"
FROM "games" dup
WHERE "games"."slug" = 'final-fantasy-xiv-online'
  AND dup."slug" = 'ffxiv';

-- Step 2: Repoint all FK references from duplicate rows to correct IGDB rows
-- Use subqueries to get IDs by slug (avoids hardcoding row IDs)

-- event_types: wow -> world-of-warcraft
UPDATE "event_types"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow');

-- event_types: wow-classic -> world-of-warcraft-classic
UPDATE "event_types"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft-classic')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow-classic');

-- event_types: ffxiv -> final-fantasy-xiv-online
UPDATE "event_types"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'final-fantasy-xiv-online')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'ffxiv');

-- events: wow -> world-of-warcraft
UPDATE "events"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow');

-- events: wow-classic -> world-of-warcraft-classic
UPDATE "events"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft-classic')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow-classic');

-- events: ffxiv -> final-fantasy-xiv-online
UPDATE "events"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'final-fantasy-xiv-online')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'ffxiv');

-- characters: wow -> world-of-warcraft
UPDATE "characters"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow');

-- characters: wow-classic -> world-of-warcraft-classic
UPDATE "characters"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft-classic')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow-classic');

-- characters: ffxiv -> final-fantasy-xiv-online
UPDATE "characters"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'final-fantasy-xiv-online')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'ffxiv');

-- availability: wow -> world-of-warcraft
UPDATE "availability"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow');

-- availability: wow-classic -> world-of-warcraft-classic
UPDATE "availability"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'world-of-warcraft-classic')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'wow-classic');

-- availability: ffxiv -> final-fantasy-xiv-online
UPDATE "availability"
SET "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'final-fantasy-xiv-online')
WHERE "game_id" = (SELECT "id" FROM "games" WHERE "slug" = 'ffxiv');

-- Step 3: Delete the duplicate rows (they have no IGDB ID and dead cover URLs)
DELETE FROM "games" WHERE "slug" = 'wow';
DELETE FROM "games" WHERE "slug" = 'wow-classic';
DELETE FROM "games" WHERE "slug" = 'ffxiv';

-- Step 4: Verify no orphaned references remain
-- (This will fail loudly if any FK still points to a deleted row, thanks to FK constraints)

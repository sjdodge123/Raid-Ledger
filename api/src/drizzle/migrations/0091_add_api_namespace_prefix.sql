-- ROK-788: Add api_namespace_prefix column and configure WoW Classic variant games.
-- This migration is idempotent (safe to re-run on fresh or existing databases).

-- Step 1: Add the column (Drizzle-generated DDL)
ALTER TABLE "games" ADD COLUMN "api_namespace_prefix" text;--> statement-breakpoint

-- Step 2: Set api_namespace_prefix on known WoW variant game rows by slug.
-- These are no-ops if the row doesn't exist (fresh DB without IGDB sync).
UPDATE games SET api_namespace_prefix = 'classic1x'
WHERE slug = 'world-of-warcraft-classic';

UPDATE games SET api_namespace_prefix = 'classicann'
WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition';

UPDATE games SET api_namespace_prefix = 'classic'
WHERE slug = 'world-of-warcraft-burning-crusade-classic';

UPDATE games SET api_namespace_prefix = 'classic'
WHERE slug = 'world-of-warcraft-wrath-of-the-lich-king';

-- Step 3: Rename WoW Classic (ID 50 in prod) to "World of Warcraft Classic Era".
-- Uses slug-based WHERE clause so it works across environments.
UPDATE games
SET name = 'World of Warcraft Classic Era',
    short_name = 'WoW Classic Era'
WHERE slug = 'world-of-warcraft-classic';

-- Step 4: Configure TBC Anniversary Edition (ID 9378 in prod) with roles/specs.
UPDATE games
SET has_roles = true,
    has_specs = true
WHERE slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition';

-- Step 5: Hide TBC content patch rows (not variant games, just expansion patches).
UPDATE games SET hidden = true
WHERE slug IN (
    'world-of-warcraft-the-burning-crusade',
    'world-of-warcraft-the-burning-crusade-the-black-temple',
    'world-of-warcraft-the-burning-crusade-fury-of-the-sunwell',
    'world-of-warcraft-the-burning-crusade-the-gods-of-zulaman'
);

-- Step 6: Insert Discord game mapping for TBC Anniversary Edition.
-- "World of Warcraft Classic" is the activity name Discord reports for TBC Anniversary.
-- Uses slug-based subquery to resolve game ID (IDs differ between environments).
INSERT INTO discord_game_mappings (discord_activity_name, game_id)
SELECT 'World of Warcraft Classic',
       g.id
FROM games g
WHERE g.slug = 'world-of-warcraft-burning-crusade-classic-anniversary-edition'
ON CONFLICT (discord_activity_name) DO NOTHING;

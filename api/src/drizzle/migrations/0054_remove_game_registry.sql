-- ROK-400: Remove game_registry table — migrate everything to games table
-- This migration:
-- 1. Adds config columns to games table
-- 2. Makes igdb_id nullable (for non-IGDB games like "Generic")
-- 3. Adds unique constraint on games.slug
-- 4. Copies config data from game_registry -> games (matched by slug)
-- 5. Inserts game_registry entries with no games match (igdb_id: null)
-- 6. Migrates event_types FK from game_registry.id (uuid) -> games.id (integer)
-- 7. Migrates characters.game_id from uuid -> integer
-- 8. Migrates events: consolidates registry_game_id + game_id -> single integer game_id
-- 9. Migrates availability.game_id from uuid -> integer
-- 10. Drops game_registry table

-- Step 1: Add config columns to games
ALTER TABLE "games" ADD COLUMN "short_name" varchar(30);
ALTER TABLE "games" ADD COLUMN "color_hex" varchar(7);
ALTER TABLE "games" ADD COLUMN "has_roles" boolean NOT NULL DEFAULT false;
ALTER TABLE "games" ADD COLUMN "has_specs" boolean NOT NULL DEFAULT false;
ALTER TABLE "games" ADD COLUMN "enabled" boolean NOT NULL DEFAULT true;
ALTER TABLE "games" ADD COLUMN "max_characters_per_user" integer NOT NULL DEFAULT 10;

-- Step 2: Make igdb_id nullable (for non-IGDB games)
ALTER TABLE "games" ALTER COLUMN "igdb_id" DROP NOT NULL;

-- Step 3: Add unique constraint on games.slug (needed for conflict resolution)
ALTER TABLE "games" ADD CONSTRAINT "games_slug_unique" UNIQUE ("slug");

-- Step 4: Copy config from game_registry to matching games rows (by slug)
UPDATE "games" g
SET
  "short_name" = gr."short_name",
  "color_hex" = gr."color_hex",
  "has_roles" = gr."has_roles",
  "has_specs" = gr."has_specs",
  "enabled" = gr."enabled",
  "max_characters_per_user" = gr."max_characters_per_user"
FROM "game_registry" gr
WHERE g."slug" = gr."slug";

-- Step 5: Insert game_registry entries that have no matching games row
INSERT INTO "games" ("name", "slug", "cover_url", "cached_at", "short_name", "color_hex", "has_roles", "has_specs", "enabled", "max_characters_per_user")
SELECT gr."name", gr."slug", gr."icon_url", NOW(), gr."short_name", gr."color_hex", gr."has_roles", gr."has_specs", gr."enabled", gr."max_characters_per_user"
FROM "game_registry" gr
WHERE NOT EXISTS (SELECT 1 FROM "games" g WHERE g."slug" = gr."slug");

-- Step 6: Migrate event_types FK (uuid -> integer)
-- 6a: Add new integer column
ALTER TABLE "event_types" ADD COLUMN "new_game_id" integer;

-- 6b: Populate via slug mapping (game_registry.id -> games.id)
UPDATE "event_types" et
SET "new_game_id" = g."id"
FROM "game_registry" gr, "games" g
WHERE et."game_id" = gr."id" AND g."slug" = gr."slug";

-- 6c: Change event_types.id from UUID to serial
-- First drop the old PK and constraints
ALTER TABLE "event_types" DROP CONSTRAINT IF EXISTS "event_types_game_slug_unique";
ALTER TABLE "event_types" DROP CONSTRAINT IF EXISTS "event_types_game_id_game_registry_id_fk";

-- 6d: Drop old UUID game_id column, rename new column
ALTER TABLE "event_types" DROP COLUMN "game_id";
ALTER TABLE "event_types" RENAME COLUMN "new_game_id" TO "game_id";
ALTER TABLE "event_types" ALTER COLUMN "game_id" SET NOT NULL;

-- 6e: Add FK constraint and unique constraint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_game_slug_unique" UNIQUE ("game_id", "slug");

-- 6f: Convert event_types.id from UUID to serial
-- Drop the UUID PK, add a serial PK
ALTER TABLE "event_types" DROP CONSTRAINT "event_types_pkey";
ALTER TABLE "event_types" DROP COLUMN "id";
ALTER TABLE "event_types" ADD COLUMN "id" serial PRIMARY KEY;

-- Step 7: Migrate characters.game_id (uuid -> integer)
-- 7a: Drop constraints that reference the old UUID column
ALTER TABLE "characters" DROP CONSTRAINT IF EXISTS "unique_user_game_character";
DROP INDEX IF EXISTS "idx_one_main_per_game";
ALTER TABLE "characters" DROP CONSTRAINT IF EXISTS "characters_game_id_game_registry_id_fk";

-- 7b: Add new integer column, populate via slug mapping
ALTER TABLE "characters" ADD COLUMN "new_game_id" integer;
UPDATE "characters" c
SET "new_game_id" = g."id"
FROM "game_registry" gr, "games" g
WHERE c."game_id" = gr."id" AND g."slug" = gr."slug";

-- 7c: Drop old column, rename new
ALTER TABLE "characters" DROP COLUMN "game_id";
ALTER TABLE "characters" RENAME COLUMN "new_game_id" TO "game_id";
ALTER TABLE "characters" ALTER COLUMN "game_id" SET NOT NULL;

-- 7d: Recreate constraints
ALTER TABLE "characters" ADD CONSTRAINT "characters_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE;
ALTER TABLE "characters" ADD CONSTRAINT "unique_user_game_character" UNIQUE ("user_id", "game_id", "name", "realm");
CREATE UNIQUE INDEX "idx_one_main_per_game" ON "characters" ("user_id", "game_id") WHERE "is_main" = true;

-- Step 8: Migrate events (consolidate registry_game_id + game_id -> single integer game_id)
-- 8a: Drop old FK and index
DROP INDEX IF EXISTS "idx_events_registry_game_id";
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_registry_game_id_game_registry_id_fk";

-- 8b: Add new integer column
ALTER TABLE "events" ADD COLUMN "new_game_id" integer;

-- 8c: Populate from registry_game_id (uuid -> integer via slug mapping)
UPDATE "events" e
SET "new_game_id" = g."id"
FROM "game_registry" gr, "games" g
WHERE e."registry_game_id" = gr."id" AND g."slug" = gr."slug";

-- 8d: For events with legacy text game_id but no registry_game_id, map via igdb_id
UPDATE "events" e
SET "new_game_id" = g."id"
FROM "games" g
WHERE e."new_game_id" IS NULL
  AND e."game_id" IS NOT NULL
  AND g."igdb_id" = CAST(e."game_id" AS integer);

-- 8e: Drop old columns, rename new
ALTER TABLE "events" DROP COLUMN "game_id";
ALTER TABLE "events" DROP COLUMN "registry_game_id";
ALTER TABLE "events" RENAME COLUMN "new_game_id" TO "game_id";

-- 8f: Add FK constraint and index
ALTER TABLE "events" ADD CONSTRAINT "events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "games"("id");
CREATE INDEX "idx_events_game_id" ON "events" ("game_id");

-- Step 9: Migrate availability.game_id (uuid -> integer, nullable)
-- 9a: Drop old FK
ALTER TABLE "availability" DROP CONSTRAINT IF EXISTS "availability_game_id_game_registry_id_fk";

-- 9b: Add new integer column
ALTER TABLE "availability" ADD COLUMN "new_game_id" integer;

-- 9c: Populate via slug mapping
UPDATE "availability" a
SET "new_game_id" = g."id"
FROM "game_registry" gr, "games" g
WHERE a."game_id" = gr."id" AND g."slug" = gr."slug";

-- 9d: Drop old column, rename new
ALTER TABLE "availability" DROP COLUMN "game_id";
ALTER TABLE "availability" RENAME COLUMN "new_game_id" TO "game_id";

-- 9e: Add FK constraint
ALTER TABLE "availability" ADD CONSTRAINT "availability_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "games"("id");

-- Step 10: Drop game_registry table
DROP TABLE "game_registry" CASCADE;

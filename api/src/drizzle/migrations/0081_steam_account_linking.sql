-- ROK-417: Steam account linking + library/playtime sync

-- 1. Add steam_id to users table
ALTER TABLE "users" ADD COLUMN "steam_id" text;
CREATE UNIQUE INDEX "users_steam_id_unique" ON "users" ("steam_id") WHERE "steam_id" IS NOT NULL;

-- 2. Add steam_app_id to games table (for IGDB→Steam mapping)
ALTER TABLE "games" ADD COLUMN "steam_app_id" integer;

-- 3. Add playtime columns to game_interests
ALTER TABLE "game_interests" ADD COLUMN "playtime_forever" integer;
ALTER TABLE "game_interests" ADD COLUMN "playtime_2weeks" integer;
ALTER TABLE "game_interests" ADD COLUMN "last_synced_at" timestamp;

-- 4. Widen game_interests unique constraint from (user_id, game_id) to (user_id, game_id, source)
ALTER TABLE "game_interests" DROP CONSTRAINT IF EXISTS "uq_user_game_interest";
ALTER TABLE "game_interests" ADD CONSTRAINT "uq_user_game_interest_source" UNIQUE ("user_id", "game_id", "source");

-- 5. Index on steam_app_id for library sync lookups
CREATE INDEX "idx_games_steam_app_id" ON "games" ("steam_app_id") WHERE "steam_app_id" IS NOT NULL;

-- 6. Update CHECK constraint to allow new source values
ALTER TABLE "game_interests" DROP CONSTRAINT IF EXISTS "chk_game_interests_source";
ALTER TABLE "game_interests" ADD CONSTRAINT "chk_game_interests_source" CHECK ("source" IN ('manual', 'discord', 'steam_library', 'steam_wishlist'));

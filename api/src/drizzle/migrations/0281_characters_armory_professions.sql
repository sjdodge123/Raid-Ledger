ALTER TABLE "characters" ADD COLUMN "armory_professions" jsonb;--> statement-breakpoint
-- ROK-2107 (hand-appended backfill, spec D7): before this migration the Blizzard
-- sync wrote into "professions". For Armory-synced retail/Forever rows move that
-- value to "armory_professions" so "professions" holds only user entries.
-- Classic rows never received Blizzard professions and stay manual.
UPDATE "characters"
SET "armory_professions" = "professions", "professions" = NULL
WHERE "external_id" IS NOT NULL
  AND "game_variant" IN ('retail', 'wow_forever')
  AND "professions" IS NOT NULL
  AND "armory_professions" IS NULL;

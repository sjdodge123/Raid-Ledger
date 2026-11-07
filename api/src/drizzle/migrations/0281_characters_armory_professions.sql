ALTER TABLE "characters" ADD COLUMN "armory_professions" jsonb;--> statement-breakpoint
-- ROK-2107 (hand-appended backfill, spec D7): before this migration the Blizzard
-- sync wrote into "professions". For Armory-synced retail/Forever rows move that
-- value to "armory_professions" so "professions" holds only user entries.
-- "Armory-synced" = "last_synced_at" IS NOT NULL: every Armory sync path stamps
-- it, while retail imports and a refreshed manual Forever row never set
-- "external_id". Classic rows never received Blizzard professions and stay manual.
-- Accepted cost (spec F2): an Armory value the user hand-edited after the last
-- sync is indistinguishable here, so it moves too and loses its Manual label.
UPDATE "characters"
SET "armory_professions" = "professions", "professions" = NULL
WHERE "last_synced_at" IS NOT NULL
  AND "game_variant" IN ('retail', 'wow_forever')
  AND "professions" IS NOT NULL
  AND "armory_professions" IS NULL;

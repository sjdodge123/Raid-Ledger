ALTER TABLE "guild_members" ADD COLUMN "ledgerlink_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_members" ADD COLUMN "blizzard_seen_at" timestamp with time zone;--> statement-breakpoint
-- ROK-2225 backfill, self-contained (no app code). A GUID row's last_seen_at is
-- the last LedgerLink import's stamp, unless the guild's latest Blizzard sync
-- stamped it; then the import before that sync is dated by the newest GUID row
-- stamped before it. GUID-less rows were never listed by an import: left NULL.
UPDATE "guild_members" AS gm
SET "ledgerlink_seen_at" = CASE
  WHEN g."blizzard_roster_synced_at" IS NULL
    OR gm."last_seen_at" IS DISTINCT FROM g."blizzard_roster_synced_at"
  THEN gm."last_seen_at"
  ELSE (
    SELECT max(o."last_seen_at") FROM "guild_members" AS o
    WHERE o."guild_id" = gm."guild_id"
      AND o."guid" IS NOT NULL
      AND o."last_seen_at" < g."blizzard_roster_synced_at"
  )
END
FROM "guilds" AS g
WHERE g."id" = gm."guild_id" AND gm."guid" IS NOT NULL;--> statement-breakpoint
-- ROK-2225 backfill, self-contained (no app code). Every row the guild's
-- latest Blizzard sync listed got last_seen_at = blizzard_roster_synced_at,
-- so rows Blizzard can see (a Blizzard id, or no GUID) stamped at or after it
-- are taken as that sync's roster, all with the sync's own instant. A later
-- import can re-stamp a row the sync dropped; such a row counts as removed
-- once on the next sync, then falls out. Other rows stay NULL.
UPDATE "guild_members" AS gm
SET "blizzard_seen_at" = g."blizzard_roster_synced_at"
FROM "guilds" AS g
WHERE g."id" = gm."guild_id"
  AND g."blizzard_roster_synced_at" IS NOT NULL
  AND (gm."blizzard_character_id" IS NOT NULL OR gm."guid" IS NULL)
  AND gm."last_seen_at" >= g."blizzard_roster_synced_at";

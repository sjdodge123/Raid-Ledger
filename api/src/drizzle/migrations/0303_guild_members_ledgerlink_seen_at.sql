ALTER TABLE "guild_members" ADD COLUMN "ledgerlink_seen_at" timestamp with time zone;--> statement-breakpoint
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
WHERE g."id" = gm."guild_id" AND gm."guid" IS NOT NULL;

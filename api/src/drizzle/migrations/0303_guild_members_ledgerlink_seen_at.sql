ALTER TABLE "guild_members" ADD COLUMN "ledgerlink_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_members" ADD COLUMN "blizzard_seen_at" timestamp with time zone;--> statement-breakpoint
-- ROK-2225 backfill, self-contained (no app code). Dates each guild's last
-- LedgerLink import ONCE ("a"): the latest snapshot when it came after the
-- latest Blizzard sync (it was an import); otherwise the newest last_seen_at
-- of an import-only row (GUID, no Blizzard id: the sync never stamps those),
-- or the latest snapshot when no such row exists (fully paired guild).
-- GUID rows stamped before that anchor keep last_seen_at. At or after it,
-- only rows live at the latest snapshot, or import-only rows, get the anchor
-- itself. A paired row a sync stamped after the anchor that is not live now
-- has left since: it stays NULL (not in the last import) instead of being
-- re-counted as removed by the first post-deploy import. No anchor (or no
-- last_seen_at): rows keep last_seen_at. GUID-less rows stay NULL.
WITH "li" AS (
  SELECT "guild_id", max("last_seen_at") AS "t" FROM "guild_members"
  WHERE "guid" IS NOT NULL AND "blizzard_character_id" IS NULL
  GROUP BY "guild_id"
), "a" AS (
  SELECT g."id" AS "guild_id", g."last_snapshot_at" AS "snap", CASE
    WHEN g."blizzard_roster_synced_at" < g."last_snapshot_at"
    THEN g."last_snapshot_at"
    ELSE coalesce("li"."t", g."last_snapshot_at")
  END AS "t"
  FROM "guilds" AS g LEFT JOIN "li" ON "li"."guild_id" = g."id"
)
UPDATE "guild_members" AS gm
SET "ledgerlink_seen_at" = CASE
  WHEN "a"."t" IS NULL OR gm."last_seen_at" IS NULL
    OR gm."last_seen_at" < "a"."t" THEN gm."last_seen_at"
  WHEN "a"."snap" IS NULL OR gm."last_seen_at" >= "a"."snap"
    OR gm."blizzard_character_id" IS NULL THEN "a"."t"
  ELSE NULL
END
FROM "a"
WHERE "a"."guild_id" = gm."guild_id" AND gm."guid" IS NOT NULL;--> statement-breakpoint
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

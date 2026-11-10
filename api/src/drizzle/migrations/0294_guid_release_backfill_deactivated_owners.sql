-- ROK-2160 one-off backfill (hand-written data migration; drizzle-kit --custom).
--
-- From this release a DEACTIVATED owner's character no longer holds a guild
-- roster row by LedgerLink GUID (guild-link.predicates.ts `ownerActive`), so
-- the row's Blizzard-id character wins it instead. The app writes a fresh
-- `external_id_linked` (via `guid_released`) for that winner at deactivation
-- time, which makes any ROK-1794 member grant staff made for the old holder
-- unconfirmed for the new winner (guild-delegation.helpers.ts
-- `claimedSinceGrant`). Owners ALREADY deactivated before this release never
-- got that audit, so their rows would flip AND hand the grant to the winner on
-- deploy. This writes the missing audit for every such winner, dated now:
-- later than every existing grant, so no grant moves without a staff re-grant.
--
-- Mirrors `auditGuidRelease` (external-id.guid-release.ts) for each GUID held
-- by a deactivated owner's character, with the winner picked by the post-deploy
-- `blizzardIdLink()` predicate. Metadata matches `logExternalIdLinked`, plus a
-- `backfill` marker that makes a re-run a no-op. Self-contained SQL; no app job.
INSERT INTO "activity_log" ("entity_type", "entity_id", "action", "actor_id", "metadata")
SELECT DISTINCT ON (w."id")
  'addon_guid',
  w."user_id",
  'external_id_linked',
  NULL,
  jsonb_build_object(
    'characterId', w."id"::text,
    'externalId', w."external_id",
    'gameId', w."game_id",
    'region', w."region",
    'via', 'guid_released',
    'ownerId', w."user_id",
    'backfill', 'rok-2160'
  )
FROM "guild_members" gm
JOIN "guilds" g ON g."id" = gm."guild_id"
-- The row's GUID is held by a deactivated owner's character (arm A's scope).
JOIN "characters" h
  ON gm."guid" IS NOT NULL
 AND h."addon_guid" = gm."guid"
 AND h."game_id" = g."game_id"
 AND (h."region" IS NULL OR lower(h."region") = lower(g."region"))
JOIN "users" hu ON hu."id" = h."user_id" AND hu."deactivated_at" IS NOT NULL
-- The winner after deploy: arm B (`blizzardIdLink`).
JOIN "characters" w
  ON gm."blizzard_character_id" IS NOT NULL
 AND w."external_id" = gm."blizzard_character_id"::text
 AND w."game_id" = g."game_id"
 AND lower(w."region") = lower(g."region")
WHERE
  -- No ACTIVE owner's character still holds the row's GUID.
  NOT EXISTS (
    SELECT 1 FROM "characters" ah
    JOIN "users" au ON au."id" = ah."user_id" AND au."deactivated_at" IS NULL
    WHERE ah."addon_guid" = gm."guid"
      AND ah."game_id" = g."game_id"
      AND (ah."region" IS NULL OR lower(ah."region") = lower(g."region"))
  )
  -- The winner does not GUID-link to another live row of the same guild.
  AND NOT (
    (w."region" IS NULL OR lower(w."region") = lower(g."region"))
    AND w."addon_guid" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "guild_members" o
      WHERE o."guild_id" = gm."guild_id"
        AND o."id" <> gm."id"
        AND o."guid" = w."addon_guid"
        AND (g."last_snapshot_at" IS NULL OR o."last_seen_at" >= g."last_snapshot_at")
    )
  )
  -- Idempotent: one backfill audit per winning character, ever.
  AND NOT EXISTS (
    SELECT 1 FROM "activity_log" al
    WHERE al."entity_type" = 'addon_guid'
      AND al."action" = 'external_id_linked'
      AND al."metadata"->>'characterId' = w."id"::text
      AND al."metadata"->>'backfill' = 'rok-2160'
  )
ORDER BY w."id";

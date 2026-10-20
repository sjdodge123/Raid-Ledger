-- ROK-1429 (ROK-1428 D7) — HAND-WRITTEN data backfill (`drizzle-kit generate
-- --custom`; no codegen, so 0239_snapshot.json equals 0238 apart from id/prevId).
--
-- Every hub channel set before the lifecycle automation existed was set by a
-- Leader, so it is a manual override the reconciler must never replace. Self-
-- contained: derived from the row itself, no app-side data. Idempotent.
UPDATE "guild_profiles"
SET "discord_channel_source" = 'manual'
WHERE "discord_channel_id" IS NOT NULL
  AND "discord_channel_source" IS NULL;

-- ROK-2015 (D4) — HAND-WRITTEN data backfill (`drizzle-kit generate --custom`;
-- no codegen, so 0259_snapshot.json equals 0258 apart from id/prevId).
--
-- `source_name` is the in-game name the addon last reported. No `wow_guild`
-- row can carry `name_overridden = true` before ROK-2015 (the rename route
-- refused WoW), so every WoW `name` IS its in-game name here. Self-contained:
-- derived from the row itself, no app-side data. Idempotent.
UPDATE "guilds"
SET "source_name" = "name"
WHERE "kind" = 'wow_guild'
  AND "source_name" IS NULL;

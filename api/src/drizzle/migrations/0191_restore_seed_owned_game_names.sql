-- ROK-1643: restore the curated names of seed-owned games.
-- IGDB enrichment used to overwrite games.name on conflict by igdb_id, so
-- e.g. slug 'world-of-warcraft-classic' became "World of Warcraft Classic"
-- after 0091 had named it "World of Warcraft Classic Era". The code fix
-- (keepSeedOwned) stops the overwrite; this puts the names back on existing
-- installs. Pure SQL; no-op for rows that are absent or already correct.
-- Names mirror api/src/games-lookup/seed-games.data.ts as of 2026-09-22.
--
-- Step 1: an igdb-keyed seed row whose slug IGDB rewrote gets its seed slug
-- (and name) back, when that slug is still free. Without this, the boot seed
-- misses it by slug, and a drifted name too makes it INSERT and hit
-- UNIQUE(igdb_id).
UPDATE games AS g
SET name = v.name, slug = v.slug
FROM (VALUES
  (123, 'world-of-warcraft', 'World of Warcraft'),
  (75379, 'world-of-warcraft-classic', 'World of Warcraft Classic Era'),
  (104967, 'valheim', 'Valheim'),
  (14729, 'final-fantasy-xiv-online', 'Final Fantasy XIV Online')
) AS v(igdb_id, slug, name)
WHERE g.igdb_id = v.igdb_id
  AND g.slug <> v.slug
  AND NOT EXISTS (SELECT 1 FROM games x WHERE x.slug = v.slug);
--> statement-breakpoint
-- Step 2: restore every seed game's name by slug.
UPDATE games AS g
SET name = v.name
FROM (VALUES
  ('world-of-warcraft', 'World of Warcraft'),
  ('world-of-warcraft-classic', 'World of Warcraft Classic Era'),
  ('world-of-warcraft-burning-crusade-classic-anniversary-edition', 'World of Warcraft: Burning Crusade Classic - Anniversary Edition'),
  ('world-of-warcraft-forever', 'World of Warcraft: Forever'),
  ('valheim', 'Valheim'),
  ('final-fantasy-xiv-online', 'Final Fantasy XIV Online'),
  ('generic', 'Generic'),
  ('chao-chao', 'Chao Chao')
) AS v(slug, name)
WHERE g.slug = v.slug
  AND g.name IS DISTINCT FROM v.name;

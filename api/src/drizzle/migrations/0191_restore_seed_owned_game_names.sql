-- ROK-1643: restore the curated names of seed-owned games.
-- IGDB enrichment used to overwrite games.name on conflict by igdb_id, so
-- e.g. slug 'world-of-warcraft-classic' became "World of Warcraft Classic"
-- after 0091 had named it "World of Warcraft Classic Era". The code fix
-- (keepSeedOwned) stops the overwrite; this puts the names back on existing
-- installs. Pure SQL keyed by slug; no-op for rows that are absent or already
-- correct. Names mirror api/src/games-lookup/seed-games.data.ts.
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

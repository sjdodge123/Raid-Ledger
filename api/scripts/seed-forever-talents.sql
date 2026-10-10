-- ROK-1744 fleet seed: WoW: Forever talents test characters for admin@local.
-- Re-runnable (deletes its own rows first). Run AFTER the fleet gate (gates
-- reset the env DB). Prints one row per character: name, id, case.
--   Brakgrid    Forever Warrior, schema-2 snapshot, 52 positioned nodes
--               (16/20/16), spent 31/20/0, two maxed nodes, many rank-0 → grid
--   Brakpills   Forever Warrior, ranked-only nodes without positions,
--               3 named + 4 unnamed → list (pills + "+4 unnamed")
--   Brakclassic Classic Era Warrior with stored Blizzard-style classic talents
--               and a snapshot row → classic display unchanged (variant gate)

DELETE FROM characters c
USING local_credentials lc
WHERE lc.user_id = c.user_id
  AND lc.email = 'admin@local'
  AND c.name IN ('Brakgrid', 'Brakpills', 'Brakclassic');

WITH admin AS (
  SELECT lc.user_id AS id FROM local_credentials lc WHERE lc.email = 'admin@local'
),
fg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-forever'),
cg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic'),
grid_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region, ruleset)
  SELECT admin.id, fg.id, 'Brakgrid', 'Forever', 'Warrior', 'Arms', 60, 'us', 'normal'
  FROM admin, fg RETURNING id
),
list_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region, ruleset)
  SELECT admin.id, fg.id, 'Brakpills', 'Forever', 'Warrior', 'Fury', 12, 'us', 'normal'
  FROM admin, fg RETURNING id
),
classic_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region,
                          game_variant, talents, last_synced_at)
  SELECT admin.id, cg.id, 'Brakclassic', 'Whitemane', 'Warrior', 'Arms', 60, 'us',
         'classic_era',
         '{"format":"classic","summary":"31/20/0","trees":[
            {"name":"Arms","spentPoints":31,"talents":[
              {"name":"Deflection","rank":5,"tierIndex":0,"columnIndex":1},
              {"name":"Mortal Strike","rank":1,"tierIndex":6,"columnIndex":1}]},
            {"name":"Fury","spentPoints":20,"talents":[
              {"name":"Cruelty","rank":5,"tierIndex":0,"columnIndex":2}]},
            {"name":"Protection","spentPoints":0,"talents":[]}]}'::jsonb,
         now()
  FROM admin, cg RETURNING id
),
cells AS (
  SELECT i, t, i - CASE t WHEN 0 THEN 0 WHEN 1 THEN 16 ELSE 36 END AS j
  FROM (SELECT i, CASE WHEN i < 16 THEN 0 WHEN i < 36 THEN 1 ELSE 2 END AS t
        FROM generate_series(0, 51) AS i) s
),
ranked AS (
  SELECT i, t, j,
    CASE WHEN t = 0 AND j < 2 THEN 3 WHEN t = 0 AND j < 8 THEN 4
         WHEN t = 0 AND j = 8 THEN 1 WHEN t = 1 AND j < 5 THEN 4 ELSE 0 END AS rank,
    CASE WHEN t = 0 AND j < 2 THEN 3 ELSE 5 END AS max_ranks
  FROM cells
),
grid_nodes AS (
  SELECT jsonb_agg(jsonb_build_object(
    'nodeId', 1000 + i, 'rank', rank, 'maxRanks', max_ranks,
    'name', (ARRAY['Arms', 'Fury', 'Protection'])[t + 1] || ' talent ' || (j + 1),
    'spellId', 20000 + i,
    'posX', (ARRAY[1020, 5020, 9080])[t + 1] + (j % 4) * 600,
    'posY', 2130 + (j / 4) * 600,
    'entryId', 5000 + i) ORDER BY i) AS nodes
  FROM ranked
),
snaps AS (
  INSERT INTO character_addon_snapshots
    (character_id, section, schema, data, captured_at, payload_sha256)
  SELECT grid_char.id, 'char', 2, jsonb_build_object(
      'gear', '[{"slot":1,"itemId":16921,"ilvl":76,"bonusIds":[]}]'::jsonb,
      'talents', jsonb_build_object('configId', 7, 'nodes', grid_nodes.nodes),
      'lockouts', '[]'::jsonb),
    now(), repeat('c', 64)
  FROM grid_char, grid_nodes
  UNION ALL
  SELECT list_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb,
      'talents', '{"configId":8,"nodes":[
        {"nodeId":201,"rank":5,"maxRanks":5,"name":"Cruelty","entryId":9201},
        {"nodeId":202,"rank":2,"maxRanks":3,"name":"Unbridled Wrath","entryId":9202},
        {"nodeId":203,"rank":1,"maxRanks":1,"name":"Piercing Howl","entryId":9203},
        {"nodeId":204,"rank":2,"entryId":9204},
        {"nodeId":205,"rank":1,"entryId":9205},
        {"nodeId":206,"rank":3,"entryId":9206},
        {"nodeId":207,"rank":1,"entryId":9207}]}'::jsonb,
      'lockouts', '[]'::jsonb),
    now(), repeat('d', 64)
  FROM list_char
  UNION ALL
  SELECT classic_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb,
      'talents', jsonb_build_object('configId', 9, 'nodes', grid_nodes.nodes),
      'lockouts', '[]'::jsonb),
    now() - interval '1 day', repeat('e', 64)
  FROM classic_char, grid_nodes
  RETURNING character_id
)
SELECT 'Brakgrid' AS name, id, 'grid' AS "case" FROM grid_char
UNION ALL SELECT 'Brakpills', id, 'list' FROM list_char
UNION ALL SELECT 'Brakclassic', id, 'classic-unchanged' FROM classic_char;

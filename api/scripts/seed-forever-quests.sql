-- ROK-1745 fleet seed: WoW: Forever quest-section test characters for admin@local.
-- Re-runnable (deletes its own rows first). Run AFTER the fleet gate (gates
-- reset the env DB). Needs the blizzard plugin's dungeon-quest table seeded
-- (the last statement prints the Forever-known (classic+forever) count M — 0 means "0 known" everywhere).
-- Prints one row per character: name, id, case.
--   Questbrak    Forever, schema-2 snapshot, 12 completed ids:
--                Ragefire Chasm 5723 5722 5724 5761 (4/6; 5724 chain 5722 -> 5724 both done)
--                Blackfathom Deeps 6563 971 1199 (3/11; 6563 chain 6562 NOT done -> 6563 done)
--                + 5 non-dungeon ids (7 15 21 33 54) -> "7 completed ... · 12 quests total"
--                in progress: 6562 mixed objectives with have/need, 783 no objectives,
--                6921 with dungeonInstanceId 227
--   Logbrak      Forever, schema-2, completed [] + 1 in progress -> "0 of M known"
--   Hiddenbrak   Forever, schema-1 snapshot without quests -> section hidden
--   Questclassic Classic Era, schema-2 snapshot WITH quests -> no request, no section

DELETE FROM characters c
USING local_credentials lc
WHERE lc.user_id = c.user_id
  AND lc.email = 'admin@local'
  AND c.name IN ('Questbrak', 'Logbrak', 'Hiddenbrak', 'Questclassic');

WITH admin AS (
  SELECT lc.user_id AS id FROM local_credentials lc WHERE lc.email = 'admin@local'
),
fg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-forever'),
cg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic'),
quest_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region)
  SELECT admin.id, fg.id, 'Questbrak', 'Forever', 'Warrior', 'Arms', 27, 'us'
  FROM admin, fg RETURNING id
),
log_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region)
  SELECT admin.id, fg.id, 'Logbrak', 'Forever', 'Warrior', 'Fury', 9, 'us'
  FROM admin, fg RETURNING id
),
hidden_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region)
  SELECT admin.id, fg.id, 'Hiddenbrak', 'Forever', 'Warrior', 'Protection', 30, 'us'
  FROM admin, fg RETURNING id
),
classic_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region,
                          game_variant)
  SELECT admin.id, cg.id, 'Questclassic', 'Whitemane', 'Warrior', 'Arms', 27, 'us',
         'classic_era'
  FROM admin, cg RETURNING id
),
quests AS (
  SELECT '{"completed":[5723,5722,5724,5761,6563,971,1199,7,15,21,33,54],
    "inProgress":[
      {"questId":6562,"title":"Trouble in the Deeps","objectives":[
        {"text":"Speak with Sentinel Aynasha","done":true},
        {"text":"Damp Note","done":true,"have":1,"need":1},
        {"text":"Twilight Acolyte slain","done":false,"have":3,"need":8},
        {"text":"Aku''mai Servant slain","done":false,"have":0,"need":4}]},
      {"questId":783,"title":"A Threat Within","objectives":[]},
      {"questId":6921,"title":"Amongst the Ruins","dungeonInstanceId":227,
       "objectives":[{"text":"Fathom Core","done":false,"have":0,"need":1}]}]}'::jsonb AS q
),
snaps AS (
  INSERT INTO character_addon_snapshots
    (character_id, section, schema, data, captured_at, payload_sha256)
  SELECT quest_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb,
      'lockouts', '[]'::jsonb, 'quests', quests.q),
    timestamptz '2026-10-01 12:00:00+00', repeat('f', 64)
  FROM quest_char, quests
  UNION ALL
  SELECT log_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb,
      'lockouts', '[]'::jsonb,
      'quests', '{"completed":[],"inProgress":[
        {"questId":33,"title":"Wolves Across the Border","objectives":[
          {"text":"Tough Wolf Meat","done":false,"have":2,"need":8}]}]}'::jsonb),
    timestamptz '2026-10-01 12:00:00+00', repeat('1', 64)
  FROM log_char
  UNION ALL
  SELECT hidden_char.id, 'char', 1, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb, 'lockouts', '[]'::jsonb),
    timestamptz '2026-10-01 12:00:00+00', repeat('2', 64)
  FROM hidden_char
  UNION ALL
  SELECT classic_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb,
      'lockouts', '[]'::jsonb, 'quests', quests.q),
    timestamptz '2026-10-01 12:00:00+00', repeat('3', 64)
  FROM classic_char, quests
  RETURNING character_id
)
SELECT 'Questbrak' AS name, id, 'log + 2 instance groups + chains' AS "case" FROM quest_char
UNION ALL SELECT 'Logbrak', id, 'log + 0 known' FROM log_char
UNION ALL SELECT 'Hiddenbrak', id, 'schema-1 hidden' FROM hidden_char
UNION ALL SELECT 'Questclassic', id, 'classic: no section' FROM classic_char;

SELECT count(*) FILTER (WHERE dungeon_instance_id IS NOT NULL) AS known_classic_dungeon_quests
FROM wow_classic_dungeon_quests WHERE expansion IN ('classic', 'forever');

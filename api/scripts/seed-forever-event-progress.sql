-- ROK-1748 fleet seed: Forever event quest pre-req progress (L5b/L5c) for admin@local.
-- Re-runnable (deletes its own rows by title/name first). Run AFTER the fleet gate
-- (gates reset the env DB). Needs the dungeon-quest table seeded on boot with the
-- Forever dataset (instance 90000003 "Excavation Site: Wetlands", 14 quests).
--
-- Event "ROK-1748 Prereq Run" (world-of-warcraft-forever, +3 days), content_instances
-- = [90000003]. Chains in that instance (prev -> next):
--   A 95647 Lost in the Thicket Things -> 95809 Heartwoven     (head done, tail not)
--   B 95810 Lost Relic Carry -> 98824 Prehistoric Prism        (addon: both done;
--                                     MANUAL untick on 95810 -> needed, wins D5/D12)
--   C 95663 Dragonmaw Rumors -> 95682 Open the Maw             (nothing done)
--   D 95664 Elder Knowledge -> 98823 Earthen Echo              (whole chain done)
-- Prereqbrak (admin, Forever, ruleset normal, race NULL so no faction filter/dedup):
--   addon completed 95647 95810 98824 95664 98823 95646; inProgress 95772
--   manual quest_progress row: 95810 picked_up=false completed=false
--   => neededTotal 2 (98824 needs 95810 [manual]; 95682 needs 95663). Without the
--      manual row it would be 1.
--   "Done" pills: 95646 95647 95664 98823 98824 (not 95810, not 95809).
-- Mateprereq (local user, Forever char): completed 95737; inProgress 95772 95795
--   => coverage 95772 = admin + Mateprereq (addon), 95795 = Mateprereq (addon).
-- "ROK-1748 Classic Run" (world-of-warcraft-classic, Wailing Caverns 63): admin
--   signed up, no character -> classic panel unchanged, no quest-prereqs request.

DELETE FROM events WHERE title IN ('ROK-1748 Prereq Run', 'ROK-1748 Classic Run');
DELETE FROM characters c
USING local_credentials lc
WHERE lc.user_id = c.user_id AND lc.email = 'admin@local' AND c.name = 'Prereqbrak';
DELETE FROM event_signups WHERE user_id IN
  (SELECT id FROM users WHERE discord_id = 'local:mateprereq');
DELETE FROM characters WHERE user_id IN
  (SELECT id FROM users WHERE discord_id = 'local:mateprereq');
DELETE FROM users WHERE discord_id = 'local:mateprereq';

WITH admin AS (
  SELECT lc.user_id AS id FROM local_credentials lc WHERE lc.email = 'admin@local'
),
fg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-forever'),
cg AS (SELECT id FROM games WHERE slug = 'world-of-warcraft-classic'),
starts AS (
  SELECT date_trunc('hour', (now() AT TIME ZONE 'UTC')::timestamp) + interval '3 days' AS t
),
mate AS (
  INSERT INTO users (username, discord_id, role)
  VALUES ('Mateprereq', 'local:mateprereq', 'member') RETURNING id
),
fev AS (
  INSERT INTO events (title, description, creator_id, game_id, duration, content_instances)
  SELECT 'ROK-1748 Prereq Run', 'ROK-1748 fleet seed: Forever pre-req progress',
         admin.id, fg.id, tsrange(starts.t, starts.t + interval '2 hours'),
         '[{"id":90000003,"name":"Excavation Site: Wetlands","shortName":"Excavation",
            "expansion":"forever","minimumLevel":24,"maximumLevel":29,
            "maxPlayers":5,"category":"dungeon"}]'::jsonb
  FROM admin, fg, starts RETURNING id
),
cev AS (
  INSERT INTO events (title, description, creator_id, game_id, duration, content_instances)
  SELECT 'ROK-1748 Classic Run', 'ROK-1748 fleet seed: Classic control (AC6)',
         admin.id, cg.id, tsrange(starts.t, starts.t + interval '2 hours'),
         '[{"id":63,"name":"Wailing Caverns"}]'::jsonb
  FROM admin, cg, starts RETURNING id
),
admin_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region, ruleset)
  SELECT admin.id, fg.id, 'Prereqbrak', 'Forever', 'Warrior', 'Arms', 26, 'us', 'normal'
  FROM admin, fg RETURNING id
),
mate_char AS (
  INSERT INTO characters (user_id, game_id, name, realm, class, spec, level, region, ruleset)
  SELECT mate.id, fg.id, 'Mateprereq', 'Forever', 'Priest', 'Holy', 25, 'us', 'normal'
  FROM mate, fg RETURNING id
),
snaps AS (
  INSERT INTO character_addon_snapshots
    (character_id, section, schema, data, captured_at, payload_sha256)
  SELECT admin_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb, 'lockouts', '[]'::jsonb,
      'quests', '{"completed":[95647,95810,98824,95664,98823,95646],
        "inProgress":[{"questId":95772,"title":"Songblade Search","objectives":[]}]}'::jsonb),
    timestamptz '2026-10-01 12:00:00+00', repeat('a', 64)
  FROM admin_char
  UNION ALL
  SELECT mate_char.id, 'char', 2, jsonb_build_object(
      'gear', '[]'::jsonb, 'talents', '{"nodes":[]}'::jsonb, 'lockouts', '[]'::jsonb,
      'quests', '{"completed":[95737],
        "inProgress":[{"questId":95772,"title":"Songblade Search","objectives":[]},
                      {"questId":95795,"title":"Fallen in the Fen","objectives":[]}]}'::jsonb),
    timestamptz '2026-10-02 12:00:00+00', repeat('b', 64)
  FROM mate_char
  RETURNING character_id
),
signups AS (
  INSERT INTO event_signups (event_id, user_id, character_id, status, confirmation_status)
  SELECT fev.id, admin.id, admin_char.id, 'signed_up', 'confirmed'
  FROM fev, admin, admin_char
  UNION ALL
  SELECT fev.id, mate.id, mate_char.id, 'signed_up', 'confirmed' FROM fev, mate, mate_char
  UNION ALL
  SELECT cev.id, admin.id, NULL, 'signed_up', 'pending' FROM cev, admin
  RETURNING id
),
manual AS (
  INSERT INTO wow_classic_quest_progress (event_id, user_id, quest_id, picked_up, completed)
  SELECT fev.id, admin.id, 95810, false, false FROM fev, admin RETURNING id
)
SELECT 'forever_event' AS what, fev.id::text AS id,
       'instance 90000003; chains A 95647>95809, B 95810>98824 (manual untick 95810), C 95663>95682, D 95664>98823' AS note
FROM fev
UNION ALL SELECT 'classic_event', cev.id::text, 'Wailing Caverns 63, admin signed up' FROM cev
UNION ALL SELECT 'Prereqbrak', admin_char.id::text, 'admin@local; expected neededTotal = 2' FROM admin_char
UNION ALL SELECT 'Mateprereq', mate_char.id::text, 'user ' || (SELECT id FROM mate) || '; covers 95772 95795' FROM mate_char
UNION ALL SELECT 'rows', (SELECT count(*) FROM snaps)::text || ' snaps / '
  || (SELECT count(*) FROM signups)::text || ' signups / '
  || (SELECT count(*) FROM manual)::text || ' manual', 'expect 2 / 3 / 1';

SELECT count(*) AS excavation_quests_known
FROM wow_classic_dungeon_quests WHERE dungeon_instance_id = 90000003;

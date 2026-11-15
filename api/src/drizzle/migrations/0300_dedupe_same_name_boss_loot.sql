-- ROK-2197 one-off cleanup (hand-written data migration; drizzle-kit --custom).
--
-- Before ROK-2193 (PR #2160) the boss seeder keyed its loot lookup by
-- `name::expansion`, so two bosses sharing a name inside one expansion got the
-- bundled loot of BOTH upserted under each boss row: Kael'thas Sunstrider
-- (Magisters' Terrace 249 / The Eye 749, tbc) and Anub'arak (Azjol-Nerub 272 /
-- Trial of the Crusader 757, wotlk). #2160 makes the lookup instance-aware and
-- puts `instanceId` on those 216 bundled rows, so the copies no longer regrow,
-- but the boot-time prune covers `classic` and `forever` loot only, so old
-- databases keep the misattributed tbc/wotlk copies.
--
-- The `owner` list below is the item -> instance assignment of
-- `boss-loot-data.json` as of #2160 (no item sits on both instances), inlined
-- so this migration depends on no app data. It deletes a loot row only when:
--   * its boss row is one of those four (name + expansion + instance), and
--   * the row's expansion is the boss's expansion, and
--   * its item_id is bundled for the OTHER instance of the same-name boss.
-- Rows for item ids not in the list (anything else) are never touched. The
-- correct copy is upserted by the seeder on boot. A re-run deletes nothing.
WITH "owner" ("name", "expansion", "instance_id", "item_ids") AS (VALUES
  -- 37 items
  ('Kael''thas Sunstrider', 'tbc', 249, ARRAY[
    34609, 34610, 34611, 34612, 34613, 34614, 34615, 34616, 34625, 34793,
    34794, 34795, 34796, 34797, 34798, 34799, 34807, 34808, 34809, 34810,
    35275, 35504, 35513, 133449, 133450, 133451, 133452, 133453, 133455,
    133459, 133472, 133473, 133474, 133475, 133476, 133477, 133479
  ]::integer[]),
  -- 2 items
  ('Kael''thas Sunstrider', 'tbc', 749, ARRAY[
    30311, 32458
  ]::integer[]),
  -- 22 items
  ('Anub''arak', 'wotlk', 272, ARRAY[
    35661, 35662, 35663, 37232, 37235, 37236, 37237, 37238, 37240, 37241,
    37242, 188408, 188409, 188410, 188419, 188420, 188421, 188422, 188423,
    188424, 188425, 188426
  ]::integer[]),
  -- 155 items
  ('Anub''arak', 'wotlk', 757, ARRAY[
    47054, 47148, 47149, 47150, 47151, 47152, 47153, 47154, 47155, 47156,
    47157, 47182, 47183, 47184, 47186, 47187, 47188, 47189, 47190, 47191,
    47192, 47193, 47194, 47195, 47203, 47204, 47205, 47206, 47207, 47208,
    47209, 47225, 47233, 47234, 47235, 47236, 47237, 47238, 47239, 47240,
    47242, 47311, 47312, 47313, 47314, 47315, 47316, 47317, 47318, 47319,
    47320, 47321, 47322, 47323, 47324, 47325, 47326, 47327, 47328, 47329,
    47330, 47472, 47473, 47474, 47475, 47476, 47477, 47478, 47479, 47480,
    47481, 47482, 47483, 47484, 47485, 47486, 47487, 47489, 47490, 47491,
    47492, 47556, 47741, 47808, 47809, 47810, 47811, 47812, 47813, 47814,
    47815, 47816, 47829, 47830, 47832, 47834, 47835, 47836, 47837, 47838,
    47894, 47895, 47896, 47897, 47898, 47899, 47900, 47901, 47902, 47903,
    47904, 47905, 47906, 47907, 47908, 47909, 47910, 47911, 47962, 47963,
    47964, 47965, 47966, 47967, 47968, 47969, 47970, 47971, 47972, 47973,
    47974, 47975, 47976, 47977, 47978, 47979, 48039, 48040, 48041, 48042,
    48043, 48044, 48045, 48046, 48047, 48048, 48049, 48050, 48051, 48052,
    48053, 48054, 48055, 48056, 142085
  ]::integer[])
)
DELETE FROM "wow_classic_boss_loot" l
USING "wow_classic_bosses" b, "owner" o
WHERE l."boss_id" = b."id"
  AND l."expansion" = b."expansion"
  AND b."name" = o."name"
  AND b."expansion" = o."expansion"
  -- Only the boss rows the list names (never a third same-name row).
  AND b."instance_id" IN (
    SELECT w."instance_id" FROM "owner" w
    WHERE w."name" = b."name" AND w."expansion" = b."expansion"
  )
  -- The item is bundled for the other instance of this boss name.
  AND o."instance_id" <> b."instance_id"
  AND l."item_id" = ANY (o."item_ids");

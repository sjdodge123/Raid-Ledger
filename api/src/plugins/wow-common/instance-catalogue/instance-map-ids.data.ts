/**
 * ROK-2218: the Classic 5-man dungeons keyed by the in-game MAP id that
 * LedgerLink pulls carry (`addon_encounter_pulls.instance_id`, the
 * `GetInstanceInfo()` id) → catalogue (Journal) id. It is NOT the Journal
 * id: Gnomeregan is map 90 but Journal 231. A multi-wing dungeon is one map,
 * so it points at its top-level row (Dire Maul 429 → 230, Stratholme 329 →
 * 236, Blackrock Spire 229 → 229, Scarlet Monastery 189 → 316). Classic Era
 * map ids; the Forever-only maps (e.g. 3065) are the ROK-2219 table below.
 * Raids stay in `guilds/progression/raid-map-instances.ts`.
 */
export const CLASSIC_DUNGEON_MAP_TO_JOURNAL: ReadonlyMap<number, number> =
  new Map([
    [389, 226], // Ragefire Chasm
    [43, 240], // Wailing Caverns
    [36, 63], // Deadmines
    [33, 64], // Shadowfang Keep
    [48, 227], // Blackfathom Deeps
    [34, 238], // The Stockade
    [90, 231], // Gnomeregan
    [47, 234], // Razorfen Kraul
    [189, 316], // Scarlet Monastery
    [129, 233], // Razorfen Downs
    [70, 239], // Uldaman
    [209, 241], // Zul'Farrak
    [349, 232], // Maraudon
    [109, 237], // The Temple of Atal'hakkar
    [230, 228], // Blackrock Depths
    [229, 229], // Blackrock Spire
    [429, 230], // Dire Maul
    [289, 246], // Scholomance
    [329, 236], // Stratholme
  ]);

/**
 * ROK-2219: the nine Forever-new 5-man dungeons, in-game map id → catalogue
 * Forever seed id (`forever-new.data.ts`). Their boss rows are the `forever`
 * rows on the seed id in `data/boss-encounter-data.json`, in encounter order.
 *
 * Source: the Forever client's `Map` DB2 (`MapName_lang`, `InstanceType` 1),
 * cross-checked against `GroupFinderActivity.MapID` (GFA id in the comment)
 * and `DungeonEncounter.MapID`; wago.tools product `wowf`, build 1.60.1.70938
 * (2026-11-13) — https://wago.tools/db2/Map/csv?build=1.60.1.70938
 * The Forever raids (Barrow Deeps, Hyjal Summit) are not in that build.
 * Refresh by re-pulling `Map` + `DungeonEncounter` for the newest `wowf` build.
 */
export const FOREVER_DUNGEON_MAP_TO_SEED: ReadonlyMap<number, number> = new Map(
  [
    [3065, 90_000_001], // The Hall of Thanes, GFA #1984
    [2999, 90_000_002], // Ruins of Lordaeron, GFA #1982
    [2998, 90_000_003], // Excavation Site: Wetlands, GFA #1981
    [2959, 90_000_004], // City of Dalaran, GFA #1983
    [2970, 90_000_005], // The Drowned City, GFA #1985
    [3039, 90_000_006], // Krol'dok Stronghold, GFA #1986
    [2994, 90_000_007], // Alcaz Prison, GFA #1980
    [2974, 90_000_008], // Blackmaw Hold, GFA #1979
    [3001, 90_000_009], // The Shaper's Terrace, GFA #1978
  ],
);

/** Every dungeon map id the Progression tab places: Classic, then Forever. */
export const DUNGEON_MAP_TO_JOURNAL: ReadonlyMap<number, number> = new Map([
  ...CLASSIC_DUNGEON_MAP_TO_JOURNAL,
  ...FOREVER_DUNGEON_MAP_TO_SEED,
]);

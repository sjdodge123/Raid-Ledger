/**
 * ROK-2218: the Classic 5-man dungeons keyed by the in-game MAP id that
 * LedgerLink pulls carry (`addon_encounter_pulls.instance_id`, the
 * `GetInstanceInfo()` id) → catalogue (Journal) id. It is NOT the Journal
 * id: Gnomeregan is map 90 but Journal 231. A multi-wing dungeon is one map,
 * so it points at its top-level row (Dire Maul 429 → 230, Stratholme 329 →
 * 236, Blackrock Spire 229 → 229, Scarlet Monastery 189 → 316). Classic Era
 * map ids; Forever-only maps (e.g. 3065) are not known yet. Raids stay in
 * `guilds/progression/raid-map-instances.ts`.
 */
export const DUNGEON_MAP_TO_JOURNAL: ReadonlyMap<number, number> = new Map([
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

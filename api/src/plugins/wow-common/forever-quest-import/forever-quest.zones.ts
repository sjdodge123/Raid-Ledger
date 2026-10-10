/**
 * ROK-1748: Forever seed instance n (1–11, `forever-instance-data.ts`) →
 * Wowhead `/forever/zone=<id>` id. null = not listed on Wowhead yet;
 * `--live` exits "zones not mapped" while any value is null. The script also
 * verifies each zone page title.
 */
export const FOREVER_WOWHEAD_ZONES: Readonly<Record<number, number | null>> = {
  // verified 2026-10-09: The Hall of Thanes
  1: 16919,
  // verified 2026-10-09: Ruins of Lordaeron
  2: 16611,
  // verified 2026-10-09: Excavation Site: Wetlands
  3: 16732,
  // verified 2026-10-09: City of Dalaran; 16560 is a same-named variant
  4: 16544,
  5: null,
  6: null,
  7: null,
  8: null,
  9: null,
  10: null,
  11: null,
};

/** Seed ns with no Wowhead zone id yet, ascending. */
export function unmappedZones(): number[] {
  return Object.entries(FOREVER_WOWHEAD_ZONES)
    .filter(([, zoneId]) => zoneId === null)
    .map(([n]) => Number(n))
    .sort((a, b) => a - b);
}

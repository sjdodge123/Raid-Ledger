/**
 * ROK-1748: Forever seed instance n (1–11, `forever-instance-data.ts`) →
 * Wowhead `/forever/zone=<id>` id. All null: the 11 seed instances are NEW
 * Forever dungeons/raids whose Wowhead zone ids are unknown until a follow-up
 * probe (L5a-post) finds them. `--live` exits "zones not mapped" while every
 * value is null; the script also verifies each zone page title.
 */
export const FOREVER_WOWHEAD_ZONES: Readonly<Record<number, number | null>> = {
  1: null,
  2: null,
  3: null,
  4: null,
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

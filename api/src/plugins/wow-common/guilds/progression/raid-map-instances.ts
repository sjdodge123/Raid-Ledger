/**
 * ROK-1789 Part B (B-3) — raid instances keyed by the in-game MAP id that
 * LedgerLink pulls carry (`addon_encounter_pulls.instance_id`, the
 * `GetInstanceInfo()` id). It is NOT the Journal id `wow_classic_bosses`
 * uses: Molten Core is map 409 (golden fixture
 * `ledgerlink/v1/fixtures/mixed-char-raid.json`) but Journal 741.
 *
 * `journalId` null = no boss rows for the raid (Zul'Gurub) → total "?".
 * Forever raid map ids (Barrow Deeps, Hyjal Summit) are not known yet, so
 * their pulls show as "Instance <mapId>" until added here (Q-B12 v1).
 */

/** One raid instance a pull map id resolves to. */
export interface RaidMapInstance {
  name: string;
  journalId: number | null;
}

/** Map id → raid instance (Classic `GetInstanceInfo` ids). */
export const RAID_MAP_INSTANCES: Readonly<Record<number, RaidMapInstance>> = {
  409: { name: 'Molten Core', journalId: 741 },
  469: { name: 'Blackwing Lair', journalId: 742 },
  249: { name: "Onyxia's Lair", journalId: 760 },
  509: { name: "Ruins of Ahn'Qiraj", journalId: 743 },
  531: { name: "Temple of Ahn'Qiraj", journalId: 744 },
  533: { name: 'Naxxramas', journalId: 754 },
  309: { name: "Zul'Gurub", journalId: null },
};

/** The raid instance for a pull's map id, or null when unknown. */
export function raidForMap(mapId: number): RaidMapInstance | null {
  return RAID_MAP_INSTANCES[mapId] ?? null;
}

/** The raid name for a Journal id in the table, or null. */
export function raidNameForJournal(journalId: number): string | null {
  for (const raid of Object.values(RAID_MAP_INSTANCES)) {
    if (raid.journalId === journalId) return raid.name;
  }
  return null;
}

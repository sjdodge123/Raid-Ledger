/**
 * ROK-2143: the 19 classic dungeons (keyed by the Blizzard journal instance
 * id `data/dungeon-quest-data.json` uses) → Blizzard quest-area id
 * (`/data/wow/quest/area/{id}`, classic AreaTable ids). Area ids come from the
 * retired Wowhead importer's zone table. `areaNames` are the names the
 * importer accepts from `quest/index` `areas[]`; a dungeon whose area name
 * does not match is skipped and reported (self-verification by name).
 * Only `verified` entries were checked against the live API (probe 2026-11-08).
 */
export interface ClassicQuestArea {
  dungeon: string;
  areaId: number;
  /** Accepted Blizzard area names (compared after `normaliseAreaName`). */
  areaNames: readonly string[];
  verified: boolean;
}

const area = (
  dungeon: string,
  areaId: number,
  aliases: readonly string[] = [],
  verified = false,
): ClassicQuestArea => ({
  dungeon,
  areaId,
  areaNames: [dungeon, ...aliases],
  verified,
});

export const CLASSIC_QUEST_AREAS: Readonly<Record<number, ClassicQuestArea>> = {
  63: area('The Deadmines', 1581, [], true),
  64: area('Shadowfang Keep', 209),
  226: area('Ragefire Chasm', 2437),
  227: area('Blackfathom Deeps', 719),
  228: area('Blackrock Depths', 1584),
  229: area('Blackrock Spire', 1583),
  230: area('Dire Maul', 2557),
  231: area('Gnomeregan', 721),
  232: area('Maraudon', 2100),
  233: area('Razorfen Downs', 722),
  234: area('Razorfen Kraul', 491),
  236: area('Stratholme', 2017),
  237: area('Sunken Temple', 1477, ["The Temple of Atal'Hakkar"]),
  238: area('The Stockade', 717, ['Stormwind Stockade'], true),
  239: area('Uldaman', 1337),
  240: area('Wailing Caverns', 718, [], true),
  241: area("Zul'Farrak", 1176),
  246: area('Scholomance', 2057),
  316: area('Scarlet Monastery', 796),
};

/** All mapped journal instance ids, ascending. */
export function classicQuestAreaInstanceIds(): number[] {
  return Object.keys(CLASSIC_QUEST_AREAS)
    .map(Number)
    .sort((a, b) => a - b);
}

/** Lower-case, drop a leading "the " and every non-alphanumeric character. */
export function normaliseAreaName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** True when `actualName` (from `quest/index`) is one of the entry's names. */
export function areaNameMatches(
  entry: ClassicQuestArea,
  actualName: string,
): boolean {
  const actual = normaliseAreaName(actualName);
  return (
    actual !== '' &&
    entry.areaNames.some((n) => normaliseAreaName(n) === actual)
  );
}

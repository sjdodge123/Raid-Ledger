/**
 * ROK-2143: the 19 classic dungeons (keyed by the Blizzard journal instance
 * id `data/dungeon-quest-data.json` uses) → Blizzard quest-area id
 * (`/data/wow/quest/area/{id}`, classic AreaTable ids). `areaNames` are the
 * names the importer accepts from `quest/index` `areas[]`; a dungeon whose
 * area name does not match is skipped and reported (self-verification by name).
 * Only `verified` entries were checked against the live API (probe 2026-11-08).
 * ROK-2210: the area id is the instance catalogue's first Forever quest area
 * (live run 3, 2026-11-09, moved Razorfen Kraul to 1717 and Uldaman to 1517 —
 * Blizzard's `quest/area/index` does not list 491 / 1337). A skipped dungeon
 * still reports the name-alike areas and its sample quest's area.
 */
import { getInstance } from '../instance-catalogue/instance-catalogue';

export interface ClassicQuestArea {
  dungeon: string;
  areaId: number;
  /** Accepted Blizzard area names (compared after `normaliseAreaName`). */
  areaNames: readonly string[];
  verified: boolean;
}

/** [journal instance id, dungeon name, extra accepted names, verified]. */
type AreaDef = readonly [number, string, (readonly string[])?, boolean?];

const AREA_DEFS: readonly AreaDef[] = [
  [63, 'The Deadmines', [], true],
  [64, 'Shadowfang Keep'],
  [226, 'Ragefire Chasm'],
  [227, 'Blackfathom Deeps'],
  [228, 'Blackrock Depths'],
  [229, 'Blackrock Spire'],
  [230, 'Dire Maul'],
  [231, 'Gnomeregan'],
  [232, 'Maraudon'],
  [233, 'Razorfen Downs'],
  [234, 'Razorfen Kraul'],
  [236, 'Stratholme'],
  [237, 'Sunken Temple', ["The Temple of Atal'Hakkar"]],
  [238, 'The Stockade', ['Stormwind Stockade'], true],
  [239, 'Uldaman'],
  [240, 'Wailing Caverns', [], true],
  [241, "Zul'Farrak"],
  [246, 'Scholomance'],
  [316, 'Scarlet Monastery'],
];

/** The catalogue's first Forever quest area of an instance; throws if none. */
function catalogueAreaId(instanceId: number): number {
  const row = getInstance(instanceId, 'wow_forever');
  const areaId = row?.foreverQuestAreaIds[0];
  if (areaId === undefined) {
    throw new Error(`ROK-2210: no Forever quest area for ${instanceId}`);
  }
  return areaId;
}

function toEntry([id, dungeon, aliases = [], verified = false]: AreaDef): [
  number,
  ClassicQuestArea,
] {
  const areaNames = [dungeon, ...aliases];
  return [id, { dungeon, areaId: catalogueAreaId(id), areaNames, verified }];
}

export const CLASSIC_QUEST_AREAS: Readonly<Record<number, ClassicQuestArea>> =
  Object.fromEntries(AREA_DEFS.map(toEntry));

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

/** Most name-alike areas reported per skipped dungeon. */
export const AREA_NAME_CANDIDATE_LIMIT = 5;

/**
 * Areas in Blizzard's list (other than the mapped id) whose name equals,
 * contains or is contained in one of the entry's names — evidence for a
 * wrong area id in the map. Never used to import; the map is fixed by hand.
 */
export function areaNameCandidates(
  entry: ClassicQuestArea,
  areas: readonly { id: number; name: string }[],
): { id: number; name: string }[] {
  const wanted = entry.areaNames.map(normaliseAreaName).filter((n) => n);
  const alike = (name: string): boolean => {
    const actual = normaliseAreaName(name);
    if (actual === '') return false;
    return wanted.some((w) => actual.includes(w) || w.includes(actual));
  };
  return areas
    .filter((a) => a.id !== entry.areaId && alike(a.name))
    .slice(0, AREA_NAME_CANDIDATE_LIMIT)
    .map(({ id, name }) => ({ id, name }));
}

/** Lowest bundled quest id of a dungeon, else null. */
export function firstKnownQuestId(
  knownQuests: ReadonlyMap<number, number>,
  instanceId: number,
): number | null {
  let first: number | null = null;
  for (const [questId, owner] of knownQuests) {
    if (owner === instanceId && (first === null || questId < first)) {
      first = questId;
    }
  }
  return first;
}

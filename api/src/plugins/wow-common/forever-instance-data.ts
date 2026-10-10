/**
 * ROK-1719: hand-seeded WoW: Forever instances (9 new dungeons, 2 new raids).
 *
 * HAND SEED — replace when the Forever journal namespace is live
 * (ROK-1716/1717). Until then Blizzard's journal does not expose these, so
 * the `wow_forever` instance list appends them to the vanilla Classic set.
 * Once the journal publishes a `Forever`-expansion row with the same name,
 * `mergeForeverSeed` drops the seed copy ("journal wins") with no code change.
 *
 * Sources (fetched 2026-10-04):
 * - Names, raid sizes: Blizzard "World of Warcraft: Forever — What's Next"
 *   panel recap (news.blizzard.com/en-us/article/24303862).
 * - Level ranges: community only (classicwow.gg/forever/dungeons,
 *   wowclassicforever.info, endgametools.com); Blizzard has published none.
 * - "Excavation Site: Wetlands" is a placeholder — Blizzard only says
 *   "an excavation site above Whelgar's Excavation".
 *
 * Events snapshot `{id, name, levels}` into `events.content_instances`, so a
 * spelling/range correction here is a one-line edit that keeps saved events.
 * Ids are fixed per name and must never be reused.
 */
import type { WowInstance, WowInstanceDetail } from './blizzard.constants';

/** Reserved id range — clear of journal ids and synthetic wing ids. */
export const FOREVER_SEED_ID_BASE = 90_000_000;
const FOREVER_SEED_ID_SPAN = 999;

/** Expansion label for Forever-only content (journal and seed alike). */
export const FOREVER_EXPANSION = 'Forever';

interface ForeverSeedInstance extends WowInstanceDetail {
  expansion: typeof FOREVER_EXPANSION;
  /** Every seed row carries a short name (see `seed`). */
  shortName: string;
  minimumLevel: number;
  maximumLevel: number;
  maxPlayers: number;
}

function seed(
  n: number,
  name: string,
  shortName: string,
  category: 'dungeon' | 'raid',
  [minimumLevel, maximumLevel, maxPlayers]: [number, number, number],
): ForeverSeedInstance {
  return {
    id: FOREVER_SEED_ID_BASE + n,
    name,
    shortName,
    expansion: FOREVER_EXPANSION,
    minimumLevel,
    maximumLevel,
    maxPlayers,
    category,
  };
}

export const FOREVER_INSTANCES: readonly ForeverSeedInstance[] = [
  seed(1, 'Hall of Thanes', 'HoT', 'dungeon', [13, 18, 5]),
  seed(2, 'Ruins of Lordaeron', 'RoL', 'dungeon', [15, 20, 5]),
  seed(3, 'Excavation Site: Wetlands', 'Excavation', 'dungeon', [24, 29, 5]),
  seed(4, 'City of Dalaran', 'Dalaran', 'dungeon', [28, 33, 5]),
  seed(5, 'The Drowned City', 'Drowned', 'dungeon', [35, 40, 5]),
  seed(6, "Krol'dok Stronghold", "Krol'dok", 'dungeon', [40, 45, 5]),
  seed(7, 'Alcaz Prison', 'Alcaz', 'dungeon', [48, 53, 5]),
  seed(8, 'Blackmaw Hold', 'Blackmaw', 'dungeon', [55, 60, 5]),
  seed(9, "Shaper's Terrace", "Shaper's", 'dungeon', [58, 60, 5]),
  seed(10, 'Barrow Deeps', 'BD', 'raid', [60, 60, 10]),
  // Not 'Hyjal' — that short name belongs to the TBC raid of the same name.
  seed(11, 'Hyjal Summit', 'HS', 'raid', [60, 60, 20]),
];

/** True for any id inside the reserved Forever seed range. */
export function isForeverSeedId(id: number): boolean {
  return (
    id > FOREVER_SEED_ID_BASE &&
    id <= FOREVER_SEED_ID_BASE + FOREVER_SEED_ID_SPAN
  );
}

/** Detail for a seeded Forever instance, or null when the id is not one. */
export function findForeverSeedInstance(id: number): WowInstanceDetail | null {
  if (!isForeverSeedId(id)) return null;
  const hit = FOREVER_INSTANCES.find((i) => i.id === id);
  return hit ? { ...hit } : null;
}

/** Lowercase, drop a leading "the ", collapse punctuation/whitespace. */
export function normalizeInstanceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** List-shaped copy of a seed row (the list DTO has no maxPlayers/category). */
function toListRow(inst: ForeverSeedInstance): WowInstance {
  const { id, name, shortName, expansion, minimumLevel, maximumLevel } = inst;
  return { id, name, shortName, expansion, minimumLevel, maximumLevel };
}

/** The seed row a journal `Forever`-expansion row stands for, if any. */
function seedFor(row: WowInstance): ForeverSeedInstance | undefined {
  if (row.expansion !== FOREVER_EXPANSION) return undefined;
  const key = normalizeInstanceName(row.name);
  return FOREVER_INSTANCES.find((i) => normalizeInstanceName(i.name) === key);
}

/**
 * Journal list rows carry only id/name/expansion. Keep the journal id and
 * name but the seed's short name and levels, so enrichInstance never applies
 * a name-keyed Classic/TBC override (Hyjal Summit would become 70-70).
 */
function withSeedMetadata(row: WowInstance): WowInstance {
  const hit = seedFor(row);
  if (!hit) return row;
  return {
    ...row,
    shortName: row.shortName ?? hit.shortName,
    minimumLevel: row.minimumLevel ?? hit.minimumLevel,
    maximumLevel: row.maximumLevel ?? hit.maximumLevel,
  };
}

/**
 * Detail-path twin of withSeedMetadata: a journal `Forever` instance keeps
 * its id, name and category but takes the seed's short name and levels —
 * buildInstanceDetail has already applied the name-keyed TBC Hyjal 70-70.
 */
export function withForeverSeedDetail(
  detail: WowInstanceDetail,
): WowInstanceDetail {
  const hit = seedFor(detail);
  if (!hit) return detail;
  return {
    ...detail,
    shortName: hit.shortName,
    minimumLevel: hit.minimumLevel,
    maximumLevel: hit.maximumLevel,
    maxPlayers: detail.maxPlayers ?? hit.maxPlayers,
  };
}

/**
 * Append the seeded Forever instances of `category` to a journal list.
 * A seed row is skipped when the list already holds a `Forever`-expansion
 * instance with the same normalized name (journal wins on id and name, the
 * seed's levels carry over). Rows of any other expansion — e.g. the TBC
 * "Hyjal Summit" — never suppress a seed row.
 */
export function mergeForeverSeed(
  list: WowInstance[],
  category: 'dungeon' | 'raid',
): WowInstance[] {
  const merged = list.map(withSeedMetadata);
  const covered = new Set(list.map(seedFor).filter((i) => i !== undefined));
  const additions = FOREVER_INSTANCES.filter(
    (i) => i.category === category && !covered.has(i),
  ).map(toListRow);
  return [...merged, ...additions];
}

/** Seed-only list, served for Forever when Blizzard's journal is down. */
export function foreverSeedOnlyList(): {
  dungeons: WowInstance[];
  raids: WowInstance[];
} {
  return {
    dungeons: mergeForeverSeed([], 'dungeon'),
    raids: mergeForeverSeed([], 'raid'),
  };
}

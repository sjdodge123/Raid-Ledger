/**
 * Boss FK lookup for the boss-loot seeder (ROK-2193).
 *
 * Two bosses can share a name inside one expansion (Kael'thas Sunstrider in
 * Magisters' Terrace 249 and The Eye 749; Anub'arak in Azjol-Nerub 272 and
 * Trial of the Crusader 757). A `name::expansion` key let whichever row an
 * unordered SELECT returned last win, so a later boot re-upserted the same
 * loot under the other boss. Every row is keyed by instance as well; the
 * instance-less key exists only for names that are unique in the expansion,
 * so a loot row for a shared name must carry its `instanceId` or it is
 * skipped — never guessed.
 */
import type { BossKeyRow } from './boss-encounter-prune.helpers';

/** The fields of a bundled loot row that pick its boss. */
export interface LootBossRef {
  bossName: string;
  expansion: string;
  /** Journal instance id — required when the boss name is shared. */
  instanceId?: number;
}

/** Boss rows indexed for loot FK resolution. */
export interface BossLookup {
  /** `name::expansion::instanceId` → boss id, for every row. */
  byInstance: Map<string, number>;
  /** `name::expansion` → boss id, only for names unique in the expansion. */
  byName: Map<string, number>;
  /** `name::expansion` keys that sit on more than one boss row. */
  shared: Set<string>;
}

/** Why a loot row resolved to no boss. */
export type LootBossMiss = 'not-found' | 'shared-name';

const nameKey = (name: string, expansion: string): string =>
  `${name}::${expansion}`;

const instanceKey = (name: string, expansion: string, id: number): string =>
  `${name}::${expansion}::${id}`;

/** Index boss rows by instance, and by name where the name is unique. */
export function buildBossLookup(rows: readonly BossKeyRow[]): BossLookup {
  const lookup: BossLookup = {
    byInstance: new Map(),
    byName: new Map(),
    shared: new Set(),
  };
  for (const b of rows) {
    const key = nameKey(b.name, b.expansion);
    lookup.byInstance.set(instanceKey(b.name, b.expansion, b.instanceId), b.id);
    if (lookup.byName.has(key)) lookup.shared.add(key);
    lookup.byName.set(key, b.id);
  }
  for (const key of lookup.shared) lookup.byName.delete(key);
  return lookup;
}

/** Boss id for a loot row within one expansion, or why there is none. */
function lookupIn(
  lookup: BossLookup,
  l: LootBossRef,
  expansion: string,
): number | LootBossMiss {
  if (l.instanceId !== undefined) {
    const k = instanceKey(l.bossName, expansion, l.instanceId);
    return lookup.byInstance.get(k) ?? 'not-found';
  }
  const key = nameKey(l.bossName, expansion);
  if (lookup.shared.has(key)) return 'shared-name';
  return lookup.byName.get(key) ?? 'not-found';
}

/**
 * Boss FK for a loot entry, or the reason it has none. ROK-2170: a `forever`
 * loot row hangs off a `forever` boss row when one exists, else off the
 * classic boss of the same name — boss rows are not duplicated for Forever.
 */
export function resolveLootBossId(
  lookup: BossLookup,
  l: LootBossRef,
): number | LootBossMiss {
  const own = lookupIn(lookup, l, l.expansion);
  if (own !== 'not-found' || l.expansion !== 'forever') return own;
  return lookupIn(lookup, l, 'classic');
}

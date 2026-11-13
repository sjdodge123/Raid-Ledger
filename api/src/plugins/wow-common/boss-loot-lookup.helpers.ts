/**
 * Boss FK lookup for the boss-loot seeder.
 *
 * Two bosses can share a name inside one expansion (Kael'thas Sunstrider in
 * Magisters' Terrace and The Eye; Anub'arak in Azjol-Nerub and Trial of the
 * Crusader). Keying only by `name::expansion` let the LAST row of an unordered
 * SELECT win, so a later boot could upsert the same loot under the other boss
 * row. Rows are keyed by name + expansion + instance; the instance-less key a
 * bundled loot row uses resolves deterministically to the lowest instanceId.
 */
import type { BossKeyRow } from './boss-encounter-prune.helpers';

/** The fields of a bundled loot row that pick its boss. */
export interface LootBossRef {
  bossName: string;
  expansion: string;
  /** Optional: disambiguates same-name bosses when the data carries it. */
  instanceId?: number;
}

/** Stable identity of a boss row: name, expansion, then instance. */
function instanceKey(
  name: string,
  expansion: string,
  instance: number,
): string {
  return `${name}::${expansion}::${instance}`;
}

/**
 * Build the boss lookup: `name::expansion::instanceId` → id for every row, and
 * `name::expansion` → id of the same-name boss with the lowest instanceId
 * (ties by id), independent of the order the rows arrive in.
 */
export function buildBossLookup(
  rows: readonly BossKeyRow[],
): Map<string, number> {
  const lookup = new Map<string, number>();
  const sorted = [...rows].sort(
    (a, b) => b.instanceId - a.instanceId || b.id - a.id,
  );
  for (const b of sorted) {
    lookup.set(instanceKey(b.name, b.expansion, b.instanceId), b.id);
    lookup.set(`${b.name}::${b.expansion}`, b.id);
  }
  return lookup;
}

/** Boss id for a loot row in one expansion (instance-specific when known). */
function lookupIn(
  lookup: Map<string, number>,
  l: LootBossRef,
  expansion: string,
): number | undefined {
  if (l.instanceId !== undefined) {
    const exact = lookup.get(instanceKey(l.bossName, expansion, l.instanceId));
    if (exact !== undefined) return exact;
  }
  return lookup.get(`${l.bossName}::${expansion}`);
}

/**
 * Boss FK for a loot entry. ROK-2170: a `forever` loot row hangs off a
 * `forever` boss row when one exists, else off the classic boss of the same
 * name — boss rows are not duplicated for Forever.
 */
export function resolveLootBossId(
  lookup: Map<string, number>,
  l: LootBossRef,
): number | undefined {
  const own = lookupIn(lookup, l, l.expansion);
  if (own !== undefined || l.expansion !== 'forever') return own;
  return lookupIn(lookup, l, 'classic');
}

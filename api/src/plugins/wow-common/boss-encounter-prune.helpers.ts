/**
 * ROK-2142: delete-stale step for the boss seeder. The seeder only upserts,
 * so a boss removed from `boss-encounter-data.json` (e.g. the retail-journal
 * Stockade/RFC/RFK/RFD/Scholomance rows that were tagged `classic`) would
 * otherwise live on in the database forever.
 *
 * Scope guard: only rows with `expansion = 'classic'` are ever candidates,
 * and the step is skipped entirely when the bundled JSON carries no classic
 * rows (an empty or truncated file must never wipe the table).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';

export const PRUNED_EXPANSION = 'classic';

export interface BossKeyRow {
  id: number;
  instanceId: number;
  name: string;
  expansion: string;
}

export interface BossJsonKey {
  instanceId: number;
  name: string;
  expansion: string;
}

const keyOf = (instanceId: number, name: string): string =>
  `${instanceId}::${name}`;

/**
 * Ids of seeded `classic` boss rows whose (instanceId, name) is no longer in
 * the bundled JSON. Returns [] when the JSON has no classic rows at all.
 */
export function findStaleClassicBossIds(
  dbRows: readonly BossKeyRow[],
  jsonBosses: readonly BossJsonKey[],
): number[] {
  const wanted = new Set(
    jsonBosses
      .filter((b) => b.expansion === PRUNED_EXPANSION)
      .map((b) => keyOf(b.instanceId, b.name)),
  );
  if (wanted.size === 0) return [];
  return dbRows
    .filter((r) => r.expansion === PRUNED_EXPANSION)
    .filter((r) => !wanted.has(keyOf(r.instanceId, r.name)))
    .map((r) => r.id);
}

/**
 * Delete stale classic bosses and their loot (loot first; the FK also
 * cascades). Returns the deleted boss ids.
 */
export async function pruneStaleClassicBosses(
  db: PostgresJsDatabase<typeof schema>,
  dbRows: readonly BossKeyRow[],
  jsonBosses: readonly BossJsonKey[],
): Promise<Set<number>> {
  const ids = findStaleClassicBossIds(dbRows, jsonBosses);
  if (ids.length === 0) return new Set();
  await db
    .delete(wowClassicBossLoot)
    .where(inArray(wowClassicBossLoot.bossId, ids));
  await db
    .delete(wowClassicBosses)
    .where(
      and(
        inArray(wowClassicBosses.id, ids),
        eq(wowClassicBosses.expansion, PRUNED_EXPANSION),
      ),
    );
  return new Set(ids);
}

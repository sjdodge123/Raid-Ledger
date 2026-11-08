/**
 * ROK-2142: delete-stale step for the boss seeder. The seeder only upserts,
 * so a boss (or a loot row) removed from `boss-encounter-data.json` /
 * `boss-loot-data.json` (e.g. the retail-journal Stockade/RFC/RFK/RFD/
 * Scholomance rows that were tagged `classic`, and the retail loot left on
 * kept bosses like Darkmaster Gandling) would otherwise live on forever.
 *
 * Scope guard: only rows with `expansion = 'classic'` are ever candidates.
 * Floor guard: the step is skipped (with a warning) when the bundled JSON
 * carries no classic rows, or clearly fewer than the database already holds —
 * a truncated file must never wipe the table.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { wowClassicBosses, wowClassicBossLoot } from '../../drizzle/schema';

export const PRUNED_EXPANSION = 'classic';

/**
 * Bosses: the curated JSON is a complete list, so it must cover at least 80%
 * of the classic rows already stored. ROK-2142 itself grows the list
 * (181 → 220) while pruning ~a dozen stale rows, so a real update stays well
 * above the line and a half-written file falls far below it.
 */
export const BOSS_PRUNE_FLOOR_RATIO = 0.8;

/**
 * Loot: ROK-2142 legitimately drops the classic loot list from 856 to 695
 * rows (−19%, retail items removed), so the floor is looser — a file with
 * less than half the stored rows is treated as truncated.
 */
export const LOOT_PRUNE_FLOOR_RATIO = 0.5;

/** Receives the reason a prune step was skipped. */
export type PruneWarn = (message: string) => void;

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

export interface LootKeyRow {
  id: number;
  bossId: number;
  itemId: number;
  expansion: string;
}

export interface LootWantedKey {
  bossId: number;
  itemId: number;
  expansion: string;
}

const isClassic = (r: { expansion: string }): boolean =>
  r.expansion === PRUNED_EXPANSION;

/** True when `wanted` is empty or below `ratio` of the stored count. */
function belowFloor(wanted: number, stored: number, ratio: number): boolean {
  return wanted === 0 || wanted < stored * ratio;
}

/**
 * Ids of seeded `classic` boss rows whose (instanceId, name) is no longer in
 * the bundled JSON. Returns [] (and warns) when the JSON fails the floor.
 */
export function findStaleClassicBossIds(
  dbRows: readonly BossKeyRow[],
  jsonBosses: readonly BossJsonKey[],
  warn?: PruneWarn,
): number[] {
  const key = (b: BossJsonKey): string => `${b.instanceId}::${b.name}`;
  const wanted = new Set(jsonBosses.filter(isClassic).map(key));
  const stored = dbRows.filter(isClassic);
  if (belowFloor(wanted.size, stored.length, BOSS_PRUNE_FLOOR_RATIO)) {
    warn?.(
      `Skipping classic boss prune: JSON has ${wanted.size} classic bosses vs ${stored.length} stored`,
    );
    return [];
  }
  return stored.filter((r) => !wanted.has(key(r))).map((r) => r.id);
}

/**
 * Ids of `classic` loot rows on classic bosses whose (bossId, itemId) is no
 * longer in the bundled JSON. Returns [] (and warns) when the JSON fails the
 * floor.
 */
export function findStaleClassicLootIds(
  lootRows: readonly LootKeyRow[],
  wantedLoot: readonly LootWantedKey[],
  classicBossIds: ReadonlySet<number>,
  warn?: PruneWarn,
): number[] {
  const key = (l: LootWantedKey): string => `${l.bossId}::${l.itemId}`;
  const wanted = new Set(wantedLoot.filter(isClassic).map(key));
  const stored = lootRows.filter(
    (r) => isClassic(r) && classicBossIds.has(r.bossId),
  );
  if (belowFloor(wanted.size, stored.length, LOOT_PRUNE_FLOOR_RATIO)) {
    warn?.(
      `Skipping classic loot prune: JSON has ${wanted.size} classic loot rows vs ${stored.length} stored`,
    );
    return [];
  }
  return stored.filter((r) => !wanted.has(key(r))).map((r) => r.id);
}

/**
 * Delete the stale classic loot and bosses in ONE transaction (the boss FK
 * also cascades to loot). The ids come from the two `findStale*` helpers, so
 * they are classic-only by construction.
 */
export async function pruneClassicRows(
  db: PostgresJsDatabase<typeof schema>,
  bossIds: readonly number[],
  lootIds: readonly number[],
): Promise<void> {
  if (bossIds.length === 0 && lootIds.length === 0) return;
  await db.transaction(async (tx) => {
    if (lootIds.length > 0)
      await tx
        .delete(wowClassicBossLoot)
        .where(inArray(wowClassicBossLoot.id, [...lootIds]));
    if (bossIds.length > 0)
      await tx
        .delete(wowClassicBosses)
        .where(inArray(wowClassicBosses.id, [...bossIds]));
  });
}

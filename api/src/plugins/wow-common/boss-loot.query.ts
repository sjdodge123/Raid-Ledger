/**
 * ROK-2176 §4.5: the boss-loot read. Left-joins the Wowhead item cache so a
 * loot row carries its stored, parsed tooltip. Read-only — this path never
 * calls Wowhead; the retry cron's boss-loot backfill fills the cache.
 *
 * Reads `wow_item_meta` directly (schema import only): injecting
 * WowItemMetaService into BossEncountersService would create a provider
 * cycle (WowItemMetaService already depends on BossEncountersService).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { BossLootDto, ItemTooltip } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { wowClassicBossLoot, wowItemMeta } from '../../drizzle/schema';

/** A stored loot row plus the joined cache tooltip (null/absent = none). */
export type BossLootRow = typeof wowClassicBossLoot.$inferSelect & {
  tooltip?: ItemTooltip | null;
};

/**
 * ROK-2170: when a boss has its own Forever loot rows, they replace the
 * Classic table (per boss). Without any, the rows pass through unchanged —
 * variants whose expansion set lacks 'forever' never load such rows.
 */
export function preferForeverLoot<T extends { expansion: string }>(
  rows: T[],
): T[] {
  const forever = rows.filter((r) => r.expansion === 'forever');
  return forever.length > 0 ? forever : rows;
}

/** Maps a loot row to its DTO; `tooltip` is the stored parse, else null. */
export function toLootDto(row: BossLootRow): BossLootDto {
  return {
    id: row.id,
    bossId: row.bossId,
    itemId: row.itemId,
    itemName: row.itemName,
    slot: row.slot,
    quality: row.quality as BossLootDto['quality'],
    itemLevel: row.itemLevel,
    dropRate: row.dropRate,
    expansion: row.expansion as BossLootDto['expansion'],
    classRestrictions: row.classRestrictions,
    iconUrl: row.iconUrl,
    itemSubclass: row.itemSubclass,
    tooltip: row.tooltip ?? null,
  };
}

/** Loot for one boss within `expansions`, each row with its cached tooltip. */
export async function loadBossLoot(
  db: PostgresJsDatabase<typeof schema>,
  bossId: number,
  expansions: string[],
): Promise<BossLootDto[]> {
  const rows: BossLootRow[] = await db
    .select({
      ...getTableColumns(wowClassicBossLoot),
      tooltip: wowItemMeta.tooltip,
    })
    .from(wowClassicBossLoot)
    .leftJoin(wowItemMeta, eq(wowItemMeta.itemId, wowClassicBossLoot.itemId))
    .where(
      and(
        eq(wowClassicBossLoot.bossId, bossId),
        inArray(wowClassicBossLoot.expansion, expansions),
      ),
    )
    .orderBy(wowClassicBossLoot.quality);
  return preferForeverLoot(rows).map(toLootDto);
}

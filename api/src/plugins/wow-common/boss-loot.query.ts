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
import { eq, getTableColumns } from 'drizzle-orm';
import type { BossLootDto, ItemTooltip } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import {
  wowClassicBosses,
  wowClassicBossLoot,
  wowItemMeta,
} from '../../drizzle/schema';
import { lootExpansionsFor } from './boss-loot-expansions';

/** A stored loot row plus the joined cache tooltip (null/absent = none). */
export type BossLootRow = typeof wowClassicBossLoot.$inferSelect & {
  tooltip?: ItemTooltip | null;
};

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

/** A loot row as the read selects it: plus its boss's instance (ROK-2209). */
type BossLootReadRow = BossLootRow & { instanceId: number };

/**
 * Loot for one boss under `variant`, each row with its cached tooltip.
 * ROK-2209: the boss's instance decides the loot expansion
 * (`lootExpansionsFor`), so a Forever read never returns Classic rows — a
 * boss without Forever rows reads as `[]`. `fallbackExpansions` is the
 * variant's expansion set for variants the catalogue does not serve.
 */
export async function loadBossLoot(
  db: PostgresJsDatabase<typeof schema>,
  bossId: number,
  variant: string,
  fallbackExpansions: (variant: string) => string[],
): Promise<BossLootDto[]> {
  const rows: BossLootReadRow[] = await db
    .select({
      ...getTableColumns(wowClassicBossLoot),
      tooltip: wowItemMeta.tooltip,
      instanceId: wowClassicBosses.instanceId,
    })
    .from(wowClassicBossLoot)
    .innerJoin(
      wowClassicBosses,
      eq(wowClassicBosses.id, wowClassicBossLoot.bossId),
    )
    .leftJoin(wowItemMeta, eq(wowItemMeta.itemId, wowClassicBossLoot.itemId))
    .where(eq(wowClassicBossLoot.bossId, bossId))
    .orderBy(wowClassicBossLoot.quality);
  const first = rows[0];
  if (!first) return [];
  const allowed = new Set(
    lootExpansionsFor(variant, first.instanceId, fallbackExpansions),
  );
  return rows.filter((r) => allowed.has(r.expansion)).map(toLootDto);
}

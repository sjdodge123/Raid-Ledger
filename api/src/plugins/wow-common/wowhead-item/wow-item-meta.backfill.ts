/**
 * ROK-2176 §4.4: boss-loot items that still need a Wowhead tooltip — no
 * `wow_item_meta` row yet, or a found row parsed by an older parser.
 * `not_found` / `error` rows are left to the existing backoff. Only
 * classic / sod / forever loot: Wowhead dataEnv 16/4 do not serve TBC,
 * Wrath or Cata items (operator Q4), so probing them would only burn two
 * requests each for a miss. The real-DB proof of this query is ROK-2176
 * L4's integration spec.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import { wowClassicBossLoot, wowItemMeta } from '../../../drizzle/schema';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from './wowhead-item.types';

/** Loot expansions Wowhead's Forever / Classic data envs can serve (Q4). */
export const BACKFILL_EXPANSIONS = ['classic', 'sod', 'forever'] as const;

/** The WHERE clause of {@link bossLootBackfillIds} (exported for its spec). */
export function backfillWhere(
  version: number = WOWHEAD_TOOLTIP_PARSE_VERSION,
): SQL | undefined {
  return and(
    inArray(wowClassicBossLoot.expansion, [...BACKFILL_EXPANSIONS]),
    or(
      isNull(wowItemMeta.itemId),
      and(
        inArray(wowItemMeta.status, ['resolved', 'classic_fallback']),
        sql`${wowItemMeta.tooltipVersion} IS DISTINCT FROM ${version}`,
      ),
    ),
  );
}

/** Up to `limit` distinct boss-loot item ids due a tooltip backfill. */
export async function bossLootBackfillIds(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
): Promise<number[]> {
  if (limit <= 0) return [];
  const rows = await db
    .selectDistinct({ itemId: wowClassicBossLoot.itemId })
    .from(wowClassicBossLoot)
    .leftJoin(wowItemMeta, eq(wowItemMeta.itemId, wowClassicBossLoot.itemId))
    .where(backfillWhere())
    .limit(limit);
  return rows.map((r) => r.itemId);
}

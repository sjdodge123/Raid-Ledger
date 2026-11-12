/**
 * ROK-2176 §4.4: boss-loot items that still need a Wowhead tooltip — no
 * `wow_item_meta` row yet, or a found row parsed by an older parser.
 * `not_found` / `error` rows are left to the existing backoff. Only
 * classic / sod / forever loot: Wowhead dataEnv 16/4 do not serve TBC,
 * Wrath or Cata items (operator Q4), so probing them would only burn two
 * requests each for a miss. The real-DB proof of this query is ROK-2176
 * L4's integration spec.
 *
 * ROK-2186: quest reward ids (`wow_classic_dungeon_quests.rewards_json`) are
 * due on the same terms and resolve through the same Wowhead tooltip fetch
 * (operator ruling 2026-11-11: the per-item tooltip endpoint is accepted).
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import {
  wowClassicBossLoot,
  wowClassicDungeonQuests,
  wowItemMeta,
} from '../../../drizzle/schema';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from './wowhead-item.types';

/** Loot expansions Wowhead's Forever / Classic data envs can serve (Q4). */
export const BACKFILL_EXPANSIONS = ['classic', 'sod', 'forever'] as const;

/** Left-joined meta row is missing, or a found row from an older parser. */
function metaDueClause(version: number): SQL | undefined {
  return or(
    isNull(wowItemMeta.itemId),
    and(
      inArray(wowItemMeta.status, ['resolved', 'classic_fallback']),
      sql`${wowItemMeta.tooltipVersion} IS DISTINCT FROM ${version}`,
    ),
  );
}

/** The WHERE clause of {@link bossLootBackfillIds} (exported for its spec). */
export function backfillWhere(
  version: number = WOWHEAD_TOOLTIP_PARSE_VERSION,
): SQL | undefined {
  return and(
    inArray(wowClassicBossLoot.expansion, [...BACKFILL_EXPANSIONS]),
    metaDueClause(version),
  );
}

/**
 * One row per reward item id of a classic/sod/forever quest. A non-array
 * `rewards_json` (null, object) unnests to nothing instead of failing.
 */
export function questRewardIdsQuery() {
  const rewards = wowClassicDungeonQuests.rewardsJson;
  return new QueryBuilder()
    .select({
      itemId:
        sql<number>`(jsonb_array_elements_text(CASE WHEN jsonb_typeof(${rewards}) = 'array' THEN ${rewards} ELSE '[]'::jsonb END))::int`.as(
          'item_id',
        ),
    })
    .from(wowClassicDungeonQuests)
    .where(
      inArray(wowClassicDungeonQuests.expansion, [...BACKFILL_EXPANSIONS]),
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

/** Up to `limit` distinct quest reward item ids due a tooltip backfill. */
export async function questRewardBackfillIds(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
): Promise<number[]> {
  if (limit <= 0) return [];
  const rewards = questRewardIdsQuery().as('quest_rewards');
  const rows = await db
    .selectDistinct({ itemId: rewards.itemId })
    .from(rewards)
    .leftJoin(wowItemMeta, eq(wowItemMeta.itemId, rewards.itemId))
    .where(metaDueClause(WOWHEAD_TOOLTIP_PARSE_VERSION))
    .limit(limit);
  return rows.map((r) => r.itemId);
}

/**
 * Boss-loot ids first, then quest reward ids topping the batch up to
 * `limit` (ROK-2186) — one batch, so the Wowhead request budget is unchanged.
 */
export async function tooltipBackfillIds(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
): Promise<number[]> {
  const loot = await bossLootBackfillIds(db, limit);
  const quests = await questRewardBackfillIds(db, limit - loot.length);
  return [...new Set([...loot, ...quests])];
}

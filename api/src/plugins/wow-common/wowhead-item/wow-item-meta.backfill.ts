/**
 * ROK-2176 §4.4: boss-loot items that still need a Wowhead tooltip — no
 * `wow_item_meta` row yet, or a found row parsed by an older parser.
 * `not_found` / `error` rows are left to the existing backoff. Only
 * classic / sod / forever loot: Wowhead dataEnv 16/4 do not serve TBC,
 * Wrath or Cata items (operator Q4), so probing them would only burn two
 * requests each for a miss. The real-DB proof of this query is ROK-2176
 * L4's integration spec.
 *
 * ROK-2186: quest reward ids (`wow_classic_dungeon_quests.rewards_json`, plus
 * the Blizzard overlay's `wow_dungeon_quest_blizzard.reward_items`, which the
 * quest read path serves in their place) are due on the same terms and resolve through the same Wowhead tooltip fetch
 * (operator ruling 2026-11-11: the per-item tooltip endpoint is accepted).
 */
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import {
  wowClassicBossLoot,
  wowClassicDungeonQuests,
  wowDungeonQuestBlizzard,
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

/** Subquery alias of {@link questRewardIdsQuery} inside the due query. */
const REWARDS_ALIAS = 'quest_rewards';

/** A jsonb column as an array; a non-array (null, object) becomes `[]`. */
function jsonbArray(column: SQLWrapper): SQL {
  return sql`CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE '[]'::jsonb END`;
}

/**
 * One row per reward item id of a classic/sod/forever quest, UNION the
 * overlay's reward ids (Codex P2 — the read path serves those in place of, or
 * beside, `rewards_json`; the overlay is Forever/classic data). UNION dedups.
 * A non-array jsonb unnests to nothing instead of failing.
 */
export function questRewardIdsQuery() {
  const qb = new QueryBuilder();
  const dataset = qb
    .select({
      itemId:
        sql<number>`(jsonb_array_elements_text(${jsonbArray(wowClassicDungeonQuests.rewardsJson)}))::int`.as(
          'item_id',
        ),
    })
    .from(wowClassicDungeonQuests)
    .where(
      inArray(wowClassicDungeonQuests.expansion, [...BACKFILL_EXPANSIONS]),
    );
  const overlay = qb
    .select({
      itemId:
        sql<number>`(jsonb_array_elements(${jsonbArray(wowDungeonQuestBlizzard.rewardItems)}) ->> 'id')::int`.as(
          'item_id',
        ),
    })
    .from(wowDungeonQuestBlizzard);
  return dataset.union(overlay);
}

/**
 * The due-reward-id query. Every `item_id` is alias-qualified: the subquery's
 * aliased field renders as a bare `"item_id"`, which Postgres rejects as
 * ambiguous with `wow_item_meta.item_id` (Codex P1).
 */
export function questRewardDueQuery(
  db: PostgresJsDatabase<typeof schema>,
  limit: number,
) {
  const rewards = questRewardIdsQuery().as(REWARDS_ALIAS);
  const itemId = sql<number>`${sql.identifier(REWARDS_ALIAS)}.${sql.identifier('item_id')}`;
  return db
    .selectDistinct({ itemId })
    .from(rewards)
    .leftJoin(wowItemMeta, eq(wowItemMeta.itemId, itemId))
    .where(metaDueClause(WOWHEAD_TOOLTIP_PARSE_VERSION))
    .limit(limit);
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
  const rows = await questRewardDueQuery(db, limit);
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

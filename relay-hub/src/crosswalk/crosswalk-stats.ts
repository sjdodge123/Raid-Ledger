import { CrosswalkKindSchema } from '@raid-ledger/contract';
import type { Sql } from 'postgres';

/** L4 key lists: every key is always emitted, in this order. */
export const STATS_SOURCES = [
  'instance',
  'wikidata',
  'rl_seed',
  'hub_admin',
] as const;
export const STATS_PROVENANCES = [
  'steam',
  'igdb',
  'itad',
  'wikidata',
  'manual',
  'unknown',
  'none',
] as const;

/** `hub-admin stats --json` and RH-5b's manifest counts (ROK-1674 L4). */
export interface CrosswalkStats {
  readonly games: number;
  readonly ids: {
    readonly byKind: Record<string, number>;
    readonly bySource: Record<string, number>;
    readonly byProvenance: Record<string, number>;
  };
  readonly conflicts: { readonly open: number; readonly total: number };
}

interface CountRow {
  readonly k: string;
  readonly n: number;
}

/** Fixed keys first (0 when absent), then any unexpected key, sorted. */
export function fillCounts(
  keys: readonly string[],
  rows: readonly CountRow[],
): Record<string, number> {
  const extras = rows
    .map((r) => r.k)
    .filter((k) => !keys.includes(k))
    .sort();
  const out: Record<string, number> = {};
  for (const k of [...keys, ...extras]) out[k] = 0;
  for (const r of rows) out[r.k] = r.n;
  return out;
}

type Column = 'kind' | 'source' | 'provenance';

async function countBy(sql: Sql, column: Column): Promise<CountRow[]> {
  return sql<CountRow[]>`
    SELECT coalesce(${sql(column)}, 'none') AS k, count(*)::int AS n
    FROM hub_game_ids GROUP BY 1`;
}

/** Read-only counts with a stable shape and no timestamps (AC 4). */
export async function collectStats(sql: Sql): Promise<CrosswalkStats> {
  const [games] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hub_games`;
  const [conflicts] = await sql<{ open: number; total: number }[]>`
    SELECT count(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
           count(*)::int AS total
    FROM hub_crosswalk_conflicts`;
  return {
    games: games?.n ?? 0,
    ids: {
      byKind: fillCounts(
        CrosswalkKindSchema.options,
        await countBy(sql, 'kind'),
      ),
      bySource: fillCounts(STATS_SOURCES, await countBy(sql, 'source')),
      byProvenance: fillCounts(
        STATS_PROVENANCES,
        await countBy(sql, 'provenance'),
      ),
    },
    conflicts: { open: conflicts?.open ?? 0, total: conflicts?.total ?? 0 },
  };
}

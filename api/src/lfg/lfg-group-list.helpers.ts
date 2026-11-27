/**
 * ROK-2352 — the per-group reads: `GET /lfg/:gameId/groups` and the
 * `groupCount` / busiest-group `state` on the game-level `GET /lfg` rows (Q7).
 *
 * Core never parses a key: labels, kinds and sizes come from the active
 * `lfg-grouping` adapter. No adapter → the game is one folded `''` group.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  LFG_ANY_GROUP_KEY,
  type LfgGroupListItemDto,
  type LfgGroupListResponseDto,
  type LfgGroupSummaryDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from './lfg-grouping.helpers';
import {
  deriveLfgState,
  getGroupSummary,
  groupColumns,
  liveIntent,
  toGroupSummary,
  type LfgDb,
} from './lfg-query.helpers';
import type { LfgGameRef } from './lfg-group-scope.helpers';

type GameRow = LfgGameRef;

/**
 * `GET /lfg/:gameId/groups` — the whole-game group first, then the live
 * groups busiest first; `includeCatalogue` adds the adapter's empty groups.
 *
 * @param db - Drizzle handle.
 * @param game - The (visible) game.
 * @param viewerId - Caller, for `hasOwnIntent`.
 * @param adapter - The active grouping adapter, or null (fold).
 * @param includeCatalogue - `?include=catalogue`.
 */
export async function readGroupList(
  db: LfgDb,
  game: GameRow,
  viewerId: number,
  adapter: LfgGroupingAdapter | null,
  includeCatalogue: boolean,
): Promise<LfgGroupListResponseDto> {
  const scope = adapter === null ? null : LFG_ANY_GROUP_KEY;
  const any = await getGroupSummary(db, game, viewerId, scope);
  const anyItem: LfgGroupListItemDto = {
    ...any,
    groupKey: LFG_ANY_GROUP_KEY,
    groupLabel: null,
    kind: 'any',
  };
  if (adapter === null) return { gameId: game.id, groups: [anyItem] };
  const [catalogue, live] = await Promise.all([
    adapter.listGroups({ gameId: game.id, gameSlug: game.slug }),
    liveKeyedSummaries(db, game.id, viewerId),
  ]);
  const items = catalogue.flatMap((d) => {
    const summary = live.get(d.key);
    if (!summary && !includeCatalogue) return [];
    return [toListItem(summary ?? emptySummary(game), d)];
  });
  items.sort((a, b) => b.activeCount - a.activeCount);
  const covered = await attachCoverage(db, game.id, adapter, items);
  return { gameId: game.id, groups: [anyItem, ...covered] };
}

/**
 * ROK-2352 P2-2 / §3.4: each live shaped group's `coverage`, from the
 * adapter (core never reads roles). Catalogue-only groups carry none.
 */
async function attachCoverage(
  db: LfgDb,
  gameId: number,
  adapter: LfgGroupingAdapter,
  items: LfgGroupListItemDto[],
): Promise<LfgGroupListItemDto[]> {
  const groups = items.flatMap((i) => {
    const { groupKey: key, rosterShape } = i;
    if (key === undefined || !rosterShape || i.activeCount === 0) return [];
    return [{ key, rosterShape, intentIds: [] as number[] }];
  });
  if (!adapter.readCoverage || groups.length === 0) return items;
  const hands = await liveHandsByGroup(
    db,
    gameId,
    groups.map((g) => g.key),
  );
  for (const g of groups) g.intentIds = hands.get(g.key) ?? [];
  const coverage = await adapter.readCoverage({ groups });
  return items.map((i) => {
    const c = i.groupKey === undefined ? undefined : coverage.get(i.groupKey);
    return c ? { ...i, coverage: c } : i;
  });
}

/** groupKey → the live hand ids of those groups (one per distinct member). */
async function liveHandsByGroup(
  db: LfgDb,
  gameId: number,
  keys: string[],
): Promise<Map<string, number[]>> {
  const t = schema.lfgIntents;
  const rows = await db
    .select({ id: t.id, groupKey: t.groupKey })
    .from(t)
    .innerJoin(schema.users, eq(schema.users.id, t.userId))
    .where(
      and(
        eq(t.gameId, gameId),
        inArray(t.groupKey, keys),
        liveIntent(new Date()),
      ),
    );
  const out = new Map<string, number[]>();
  for (const r of rows)
    out.set(r.groupKey, [...(out.get(r.groupKey) ?? []), r.id]);
  return out;
}

/** Live keyed groups of one game, by key (unknown-to-adapter keys dropped later). */
async function liveKeyedSummaries(
  db: LfgDb,
  gameId: number,
  viewerId: number,
): Promise<Map<string, LfgGroupSummaryDto>> {
  const rows = await db
    .select({ ...groupColumns(viewerId), groupKey: schema.lfgIntents.groupKey })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .where(and(eq(schema.lfgIntents.gameId, gameId), liveIntent(new Date())))
    .groupBy(schema.games.id, schema.lfgIntents.groupKey);
  return new Map(rows.map((r) => [r.groupKey, toGroupSummary(r)]));
}

function emptySummary(game: GameRow): LfgGroupSummaryDto {
  return toGroupSummary({
    gameId: game.id,
    gameName: game.name,
    gameSlug: game.slug,
    gameCoverUrl: game.coverUrl,
    viabilityThreshold: game.cooptimusOnlineMax,
    activeCount: 0,
    soonestExpiresAt: null,
    hasOwnIntent: false,
    nowCount: 0,
    soonestNowExpiresAt: null,
  });
}

function toListItem(
  summary: LfgGroupSummaryDto,
  d: LfgGroupDescriptor,
): LfgGroupListItemDto {
  return {
    ...summary,
    groupKey: d.key,
    groupLabel: d.label,
    kind: d.kind,
    size: d.size,
    ...(d.rosterShape ? { rosterShape: d.rosterShape } : {}),
    ...(d.levelRange ? { levelRange: d.levelRange } : {}),
  };
}

/**
 * Q7 — `GET /lfg` stays one row per game: `activeCount` is already distinct
 * users; this adds `groupCount` and, for a grouped game, takes `state` from
 * the busiest group (a folded game is one group, so its state is unchanged).
 *
 * @param db - Drizzle handle.
 * @param rows - The game-level summaries.
 * @param registry - Plugin registry, to tell grouped games from folded ones.
 */
export async function attachGroupCounts(
  db: LfgDb,
  rows: LfgGroupSummaryDto[],
  registry: LfgGroupingRegistry,
): Promise<LfgGroupSummaryDto[]> {
  const counts = await liveGroupSizes(
    db,
    rows.map((r) => r.gameId),
  );
  return rows.map((row) => {
    const sizes = counts.get(row.gameId) ?? [];
    if (resolveLfgGrouping(registry, row.gameSlug) === null) {
      return { ...row, groupCount: Math.min(1, row.activeCount) };
    }
    const busiest = Math.max(0, ...sizes);
    return { ...row, groupCount: sizes.length, state: deriveLfgState(busiest) };
  });
}

/** gameId → distinct live users per group (one entry per live group). */
async function liveGroupSizes(
  db: LfgDb,
  gameIds: number[],
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (gameIds.length === 0) return out;
  const t = schema.lfgIntents;
  const rows = await db
    .select({
      gameId: t.gameId,
      n: sql<number>`count(distinct ${t.userId})`.mapWith(Number),
    })
    .from(t)
    .innerJoin(schema.users, eq(schema.users.id, t.userId))
    .where(and(inArray(t.gameId, gameIds), liveIntent(new Date())))
    .groupBy(t.gameId, t.groupKey);
  for (const r of rows) out.set(r.gameId, [...(out.get(r.gameId) ?? []), r.n]);
  return out;
}

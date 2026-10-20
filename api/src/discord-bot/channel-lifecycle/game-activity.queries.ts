import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { GameActivitySignalKind } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  SIGNAL_REGISTRY,
  type GameActivitySignal,
  type SignalWindow,
} from './game-activity.signals';
import type {
  GameLifecycleActivityOptions,
  GameLifecycleActivityRow,
  GameSignalSummary,
  LifecycleCandidateBinding,
} from './game-activity.types';

export type {
  GameLifecycleActivityOptions,
  GameLifecycleActivityRow,
  GameSignalSummary,
  LifecycleCandidateBinding,
} from './game-activity.types';

/**
 * ROK-1430 (spec D1, §2.2) — per-game lifecycle activity: the signal registry
 * `UNION ALL`-ed and grouped by `(game_id, kind)` (`count(DISTINCT item_id)`,
 * `max(last_at)`), merged with `games` (name, slug), the candidate binding and
 * the suppression row. The candidate set is every game with a signal OR a
 * candidate binding (a quiet auto channel must surface to be archived).
 */

type Db = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;
const DAY_MS = 86_400_000;
const cb = schema.channelBindings;

interface AggregateRow extends Record<string, unknown> {
  game_id: number;
  kind: string;
  item_count: number;
  last_at_ms: number;
}

/** Wraps one signal's select with its kind label. */
function labelled(signal: GameActivitySignal, window: SignalWindow): SQL {
  return sql`SELECT ${signal.kind}::text AS kind, s.game_id, s.item_id, s.last_at
    FROM (${signal.select(window)}) s`;
}

/** Narrows a registry string to a known signal kind. */
function toKind(
  signals: readonly GameActivitySignal[],
  kind: string,
): GameActivitySignalKind | null {
  return signals.find((s) => s.kind === kind)?.kind ?? null;
}

/** Per-(game, kind) aggregates over the UNION ALL of every signal. */
async function selectSignalAggregates(
  db: Db,
  signals: readonly GameActivitySignal[],
  window: SignalWindow,
): Promise<Map<number, GameSignalSummary[]>> {
  const out = new Map<number, GameSignalSummary[]>();
  if (signals.length === 0) return out;
  const union = sql.join(
    signals.map((s) => labelled(s, window)),
    sql` UNION ALL `,
  );
  const rows = await db.execute<AggregateRow>(sql`
    SELECT u.game_id::int AS game_id, u.kind,
           count(DISTINCT u.item_id)::int AS item_count,
           (extract(epoch FROM max(u.last_at)) * 1000)::float8 AS last_at_ms
      FROM (${union}) u
     GROUP BY u.game_id, u.kind`);
  for (const r of rows) {
    const kind = toKind(signals, r.kind);
    if (!kind) continue;
    const gameId = Number(r.game_id);
    const summary = {
      kind,
      itemCount: Number(r.item_count),
      lastActivityAt: new Date(Number(r.last_at_ms)),
    };
    out.set(gameId, [...(out.get(gameId) ?? []), summary]);
  }
  return out;
}

/** Columns read for a candidate binding. */
const BINDING_COLUMNS = {
  gameId: cb.gameId,
  id: cb.id,
  guildId: cb.guildId,
  channelId: cb.channelId,
  lifecycleState: cb.lifecycleState,
  autoManaged: cb.autoManaged,
  pinned: cb.pinned,
  archivedAt: cb.archivedAt,
  restoreParentId: cb.restoreParentId,
  archivedOverwrites: cb.archivedOverwrites,
};

/** Candidate bindings by game: manual rows win over auto rows, then oldest first. */
async function selectCandidateBindings(
  db: Db,
  guildId: string | undefined,
): Promise<Map<number, LifecycleCandidateBinding>> {
  const rows = await db
    .select(BINDING_COLUMNS)
    .from(cb)
    .where(
      and(
        eq(cb.bindingPurpose, 'game-announcements'),
        isNull(cb.recurrenceGroupId),
        isNotNull(cb.gameId),
        guildId === undefined ? undefined : eq(cb.guildId, guildId),
      ),
    )
    .orderBy(asc(cb.autoManaged), asc(cb.createdAt));
  const out = new Map<number, LifecycleCandidateBinding>();
  for (const { gameId, ...binding } of rows) {
    if (gameId !== null && !out.has(gameId)) out.set(gameId, binding);
  }
  return out;
}

/** Game ids with a suppression row (D9). */
async function selectSuppressedGameIds(
  db: Db,
  guildId: string | undefined,
): Promise<Set<number>> {
  const t = schema.channelLifecycleSuppressions;
  const rows = await db
    .select({ gameId: t.gameId })
    .from(t)
    .where(guildId === undefined ? undefined : eq(t.guildId, guildId));
  return new Set(rows.map((r) => r.gameId));
}

/** Name + slug for the candidate games; `null` ids = every game (`allGames`). */
async function selectGames(
  db: Db,
  ids: number[] | null,
): Promise<Array<{ id: number; name: string; slug: string }>> {
  if (ids !== null && ids.length === 0) return [];
  const g = schema.games;
  return db
    .select({ id: g.id, name: g.name, slug: g.slug })
    .from(g)
    .where(ids === null ? undefined : inArray(g.id, ids))
    .orderBy(asc(g.name));
}

/** Folds a game's signals into the row totals. */
function totals(signals: GameSignalSummary[]): {
  itemCount: number;
  lastActivityAt: Date | null;
} {
  let itemCount = 0;
  let last: number | null = null;
  for (const s of signals) {
    itemCount += s.itemCount;
    const t = s.lastActivityAt.getTime();
    last = last === null ? t : Math.max(last, t);
  }
  return { itemCount, lastActivityAt: last === null ? null : new Date(last) };
}

/** Assembles one game's row from its parts plus the hub seams. */
function toRow(
  game: { id: number; name: string; slug: string },
  signals: GameSignalSummary[],
  opts: GameLifecycleActivityOptions,
  rest: Pick<GameLifecycleActivityRow, 'suppressed' | 'binding'>,
): GameLifecycleActivityRow {
  return {
    gameId: game.id,
    gameName: game.name,
    gameSlug: game.slug,
    signals,
    ...totals(signals),
    hubHold: opts.hubHoldGameIds?.has(game.id) ?? false,
    hubNeedsLink: opts.hubNeedsLinkGameIds?.has(game.id) ?? false,
    ...rest,
  };
}

/**
 * Derives per-game lifecycle activity for the reconciler and the admin list.
 *
 * @returns one row per game with a signal in the window or a candidate
 *   binding — or per game, when `allGames` (and no `gameIds`) is set
 */
export async function selectGameLifecycleActivity(
  db: Db,
  opts: GameLifecycleActivityOptions,
): Promise<GameLifecycleActivityRow[]> {
  const window = {
    now: opts.now,
    windowStart: new Date(opts.now.getTime() - opts.windowDays * DAY_MS),
  };
  const [aggregates, bindings, suppressed] = await Promise.all([
    selectSignalAggregates(db, opts.signals ?? SIGNAL_REGISTRY, window),
    selectCandidateBindings(db, opts.guildId),
    selectSuppressedGameIds(db, opts.guildId),
  ]);
  const only = opts.gameIds ? new Set(opts.gameIds) : null;
  const ids = [...new Set([...aggregates.keys(), ...bindings.keys()])].filter(
    (id) => !only || only.has(id),
  );
  const games = await selectGames(db, opts.allGames && !only ? null : ids);
  return games.map((game) =>
    toRow(game, aggregates.get(game.id) ?? [], opts, {
      suppressed: suppressed.has(game.id),
      binding: bindings.get(game.id) ?? null,
    }),
  );
}

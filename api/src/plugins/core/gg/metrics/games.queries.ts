import { and, eq, inArray, sql } from 'drizzle-orm';
import type {
  GgHoursCard,
  GgNewGamesCard,
  GgTopGamesCard,
} from '@raid-ledger/contract';
import {
  gameActivityRollups,
  gameActivitySessions,
  games,
} from '../../../../drizzle/schema';
import { utcWallClock } from '../../../../drizzle/timestamp-utils';
import type { GgCardContext } from '../gg-card.registry';
import {
  buildTopGamesCard,
  GG_TOP_GAMES_LIMIT,
  gameRefOf,
  summarizeHours,
  totalsByGame,
  type GgGameMedia,
  type GgRollupRow,
} from './games.helpers';
import { loadYearGameHabits } from './superlatives.queries';

/** New-games card list cap (contract max 10). */
const NEW_GAMES_LIMIT = 10;

/**
 * Metric 5 — the user's `month` rollups whose calendar month falls in the GG
 * year (rollup months are UTC `date_trunc` buckets, so the tz edge is the
 * rollup job's, not ours). One row per (game, month).
 */
export async function loadYearRollups(
  ctx: GgCardContext,
): Promise<GgRollupRow[]> {
  const r = gameActivityRollups;
  return ctx.db
    .select({
      gameId: r.gameId,
      name: games.name,
      coverUrl: games.coverUrl,
      month: sql<number>`extract(month from ${r.periodStart})::int`,
      seconds: r.totalSeconds,
    })
    .from(r)
    .innerJoin(games, eq(games.id, r.gameId))
    .where(
      and(
        eq(r.userId, ctx.userId),
        eq(r.period, 'month'),
        sql`${r.periodStart} >= make_date(${ctx.year}::int, 1, 1)`,
        sql`${r.periodStart} < make_date(${ctx.year + 1}::int, 1, 1)`,
      ),
    );
}

/** IGDB screenshots + videos of `gameIds`, keyed by game id. */
async function loadGameMedia(
  ctx: GgCardContext,
  gameIds: number[],
): Promise<Map<number, GgGameMedia>> {
  if (gameIds.length === 0) return new Map();
  const rows = await ctx.db
    .select({
      gameId: games.id,
      screenshots: games.screenshots,
      videos: games.videos,
    })
    .from(games)
    .where(inArray(games.id, gameIds));
  return new Map(
    rows.map((g) => [
      g.gameId,
      {
        gameId: g.gameId,
        screenshots: g.screenshots ?? [],
        videos: g.videos ?? [],
      },
    ]),
  );
}

/** Core card `hours` (metrics 5, 7); omitted without rolled-up playtime. */
export async function produceHoursCard(
  ctx: GgCardContext,
): Promise<GgHoursCard | null> {
  const [rows, habits] = await Promise.all([
    loadYearRollups(ctx),
    loadYearGameHabits(ctx),
  ]);
  return summarizeHours(rows, habits);
}

/** Core card `top-games` with IGDB backdrop media; omitted without playtime. */
export async function produceTopGamesCard(
  ctx: GgCardContext,
): Promise<GgTopGamesCard | null> {
  const rows = await loadYearRollups(ctx);
  const topIds = totalsByGame(rows)
    .slice(0, GG_TOP_GAMES_LIMIT)
    .map((t) => t.gameId);
  return buildTopGamesCard(rows, await loadGameMedia(ctx, topIds));
}

/**
 * Metric 6 — games whose first-ever session falls in the window, earliest
 * first. Same predicate as `loadYearGameHabits().newGames`.
 */
async function loadNewGames(
  ctx: GgCardContext,
): Promise<GgNewGamesCard['games']> {
  const s = gameActivitySessions;
  const first = sql`min(${s.startedAt})`;
  const rows = await ctx.db
    .select({ gameId: games.id, name: games.name, coverUrl: games.coverUrl })
    .from(s)
    .innerJoin(games, eq(games.id, s.gameId))
    .where(eq(s.userId, ctx.userId))
    .groupBy(games.id)
    .having(
      sql`${first} >= ${utcWallClock(ctx.window.start)} and ${first} < ${utcWallClock(ctx.window.end)}`,
    )
    .orderBy(first, games.id)
    .limit(NEW_GAMES_LIMIT);
  return rows.map((g) => gameRefOf({ ...g, seconds: 0 }));
}

/** Core card `new-games`; the count is the superlative's own `newGames`. */
export async function produceNewGamesCard(
  ctx: GgCardContext,
): Promise<GgNewGamesCard | null> {
  const [habits, list] = await Promise.all([
    loadYearGameHabits(ctx),
    loadNewGames(ctx),
  ]);
  return habits.newGames === 0 ? null : { count: habits.newGames, games: list };
}

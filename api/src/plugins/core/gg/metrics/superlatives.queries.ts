import { eq, sql } from 'drizzle-orm';
import { gameActivitySessions, users } from '../../../../drizzle/schema';
import { utcWallClock } from '../../../../drizzle/timestamp-utils';
import type { GgCardContext } from '../gg-card.registry';
import { attendanceOf, isOnTime } from './events.helpers';
import { countEventsCreated, loadYearSignups } from './events.queries';
import {
  pickSuperlative,
  type GgSuperlativeCard,
  type GgSuperlativeInputs,
} from './superlatives.helpers';
import { loadYearVoice } from './voice.queries';

type GameHabits = Pick<
  GgSuperlativeInputs,
  'sessions' | 'nightSessions' | 'newGames'
>;

/**
 * One row: game sessions started in the window, those starting 00:00–04:00
 * in the community tz (night owl, metric 7), and games first played in the
 * window (explorer, metric 6). `started_at` is a zone-less UTC timestamp.
 */
export async function loadYearGameHabits(
  ctx: GgCardContext,
): Promise<GameHabits> {
  const s = gameActivitySessions;
  const from = utcWallClock(ctx.window.start);
  const to = utcWallClock(ctx.window.end);
  const mine = sql`${s.userId} = ${ctx.userId}`;
  const inYear = sql`${s.startedAt} >= ${from} and ${s.startedAt} < ${to}`;
  const localHour = sql`extract(hour from ((${s.startedAt} at time zone 'UTC') at time zone ${ctx.tz}))`;
  const [row] = await ctx.db
    .select({
      sessions: sql<number>`(select count(*)::int from ${s} where ${mine} and ${inYear})`,
      nightSessions: sql<number>`(select count(*)::int from ${s} where ${mine} and ${inYear} and ${localHour} < 4)`,
      newGames: sql<number>`(select count(*)::int from (select ${s.gameId} from ${s}
        where ${mine} and ${s.gameId} is not null group by ${s.gameId}
        having min(${s.startedAt}) >= ${from} and min(${s.startedAt}) < ${to}) g)`,
    })
    .from(users)
    .where(eq(users.id, ctx.userId));
  return {
    sessions: row?.sessions ?? 0,
    nightSessions: row?.nightSessions ?? 0,
    newGames: row?.newGames ?? 0,
  };
}

/** Every number the superlative picker reads, for one user's year. */
export async function loadSuperlativeInputs(
  ctx: GgCardContext,
): Promise<GgSuperlativeInputs> {
  const [rows, created, voice, habits] = await Promise.all([
    loadYearSignups(ctx),
    countEventsCreated(ctx),
    loadYearVoice(ctx),
    loadYearGameHabits(ctx),
  ]);
  return {
    attended: rows.filter((r) => attendanceOf(r) === 'attended').length,
    onTime: rows.filter(isOnTime).length,
    created,
    voiceSeconds: voice.totalSeconds,
    ...habits,
  };
}

/** Core card `superlative` — always present (`welcome-aboard` fallback). */
export async function produceSuperlativeCard(
  ctx: GgCardContext,
): Promise<GgSuperlativeCard> {
  return pickSuperlative(await loadSuperlativeInputs(ctx));
}

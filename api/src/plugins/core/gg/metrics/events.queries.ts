import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { GgEventsCard } from '@raid-ledger/contract';
import {
  eventSignups,
  events,
  eventVoiceSessions,
} from '../../../../drizzle/schema';
import { utcWallClock } from '../../../../drizzle/timestamp-utils';
import type { GgCardContext, GgCardWindow } from '../gg-card.registry';
import {
  summarizeEvents,
  summarizeOnTime,
  summarizeRhythm,
  type GgOnTimeCard,
  type GgRhythmCard,
  type GgSignupRow,
} from './events.helpers';

/**
 * Events counted by the GG year: not cancelled, starting inside
 * `[window.start, window.end)` (`duration` is a zone-less UTC tsrange).
 */
export function ggEventInWindow(window: GgCardWindow): SQL {
  const start = sql`lower(${events.duration})`;
  return sql`${events.cancelledAt} is null
    and ${start} >= ${utcWallClock(window.start)}
    and ${start} < ${utcWallClock(window.end)}`;
}

/** `lower(duration)` as a wall-clock timestamp in the community tz. */
function localStart(tz: string): SQL {
  return sql`((lower(${events.duration}) at time zone 'UTC') at time zone ${tz})`;
}

/** Whether the user's voice session on the joined event was classified late. */
const voiceLate = sql<boolean>`exists (select 1 from ${eventVoiceSessions}
  where ${eventVoiceSessions.eventId} = ${events.id}
    and ${eventVoiceSessions.userId} = ${eventSignups.userId}
    and ${eventVoiceSessions.classification} = 'late')`;

/** One query: every signup of the user on a counted event of the year. */
export async function loadYearSignups(
  ctx: GgCardContext,
): Promise<GgSignupRow[]> {
  const local = localStart(ctx.tz);
  return ctx.db
    .select({
      signup: eventSignups,
      startMs: sql<number>`(extract(epoch from lower(${events.duration})) * 1000)::float8`,
      month: sql<number>`extract(month from ${local})::int`,
      weekday: sql<number>`extract(dow from ${local})::int`,
      hour: sql<number>`extract(hour from ${local})::int`,
      voiceLate,
    })
    .from(eventSignups)
    .innerJoin(events, eq(events.id, eventSignups.eventId))
    .where(
      and(eq(eventSignups.userId, ctx.userId), ggEventInWindow(ctx.window)),
    );
}

/** Metric 4 — counted events of the year the user created. */
export async function countEventsCreated(ctx: GgCardContext): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.creatorId, ctx.userId), ggEventInWindow(ctx.window)));
  return row?.n ?? 0;
}

/** Core card `events`. */
export async function produceEventsCard(
  ctx: GgCardContext,
): Promise<GgEventsCard | null> {
  const [rows, created] = await Promise.all([
    loadYearSignups(ctx),
    countEventsCreated(ctx),
  ]);
  return summarizeEvents(rows, created);
}

/** Core card `on-time`. */
export async function produceOnTimeCard(
  ctx: GgCardContext,
): Promise<GgOnTimeCard | null> {
  return summarizeOnTime(await loadYearSignups(ctx));
}

/** Core card `rhythm` (busiest month + favourite weekday/hour). */
export async function produceRhythmCard(
  ctx: GgCardContext,
): Promise<GgRhythmCard | null> {
  return summarizeRhythm(await loadYearSignups(ctx));
}

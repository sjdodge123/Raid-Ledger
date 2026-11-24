/**
 * ROK-2314 — while an event's reschedule poll runs
 * (`events.rescheduling_poll_id IS NOT NULL`) its Discord post is closed
 * (locked + archived) by both lock sweeps, hub and registry; lock-in or a
 * cancelled poll clears the flag and the sweeps reopen it unless its own
 * close has passed. The flag lives on `events`, so the predicate is an
 * EXISTS against it, keyed by the caller's event-id column.
 */
import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import * as schema from '../../../drizzle/schema';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

/**
 * True when the event whose id is in `eventIdCol` is mid-reschedule. Drizzle
 * (0.45) renders the interpolated `eventIdCol` table-qualified
 * (`"hub_forum_threads"."event_id"`), so it binds to the outer query; the
 * subquery's own `events` gets the `rl_ev` alias so it can never be confused
 * with an outer `events` the caller may join.
 */
export function eventReschedulingSql(eventIdCol: AnyColumn): SQL<boolean> {
  return sql<boolean>`EXISTS (SELECT 1 FROM events rl_ev WHERE rl_ev.id = ${eventIdCol} AND rl_ev.rescheduling_poll_id IS NOT NULL)`;
}

/** Whether one event is mid-reschedule (false for an unknown id). */
export async function isEventRescheduling(
  db: ForumDiscordDb,
  eventId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ pollId: schema.events.reschedulingPollId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return row !== undefined && row.pollId !== null;
}

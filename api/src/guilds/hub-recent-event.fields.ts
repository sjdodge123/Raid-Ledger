import { sql } from 'drizzle-orm';
import type { GuildRecentEventDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/**
 * ROK-2185 item 3 — the ended-event card columns, shared by the WoW
 * `raids.recent` list (ROK-1787) and the core `guilds/:id/events/past` pages
 * so both count `signedUp`/`attended` the same way. Lives in core because
 * core never imports a game plugin; the WoW queries re-export it.
 */

const { events, eventSignups } = schema;

/**
 * Signup states that count as "signed up" on an ended card. A departed
 * member did raid (attendance resolves `departed` → attended), so it stays.
 */
const SIGNED = sql`('signed_up', 'tentative', 'departed')`;

/**
 * The outer `events.id`, table-qualified: a bare `${events.id}` inside the
 * subquery renders as `"id"` and binds to `s.id` (uncorrelated).
 */
const outerEventId = sql`${events}.${sql.identifier('id')}`;

export interface RecentRow {
  id: number;
  title: string;
  duration: [Date, Date];
  signedUp: number;
  recorded: number;
  attended: number;
}

/** Ended card columns; exported for the subquery-correlation guard. */
export function recentFields() {
  const s = sql`${eventSignups} s where s.event_id = ${outerEventId}`;
  return {
    id: events.id,
    title: events.title,
    duration: events.duration,
    signedUp: sql<number>`(select count(*)::int from ${s} and s.status in ${SIGNED})`,
    recorded: sql<number>`(select count(*)::int from ${s} and s.attendance_status is not null)`,
    // Only signed-up attendees, so `attended` never exceeds `signedUp`.
    attended: sql<number>`(select count(*)::int from ${s} and s.status in ${SIGNED} and s.attendance_status = 'attended')`,
  };
}

/** Row → card; `attended` is null when no attendance was recorded. */
export function toRecentCard(row: RecentRow): GuildRecentEventDto {
  return {
    id: row.id,
    title: row.title,
    startTime: row.duration[0].toISOString(),
    signedUp: row.signedUp,
    attended: row.recorded > 0 ? row.attended : null,
  };
}

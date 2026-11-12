import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GUILD_PAST_EVENTS_PAGE_SIZE,
  type GuildPastEventsPageDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { encodePastCursor, type PastCursor } from './hub-past-events.cursor';
import {
  recentFields,
  toRecentCard,
  type RecentRow,
} from './hub-recent-event.fields';

/**
 * ROK-2185 item 3 — `GET /guilds/:id/events/past`: the hub's ENTIRE ended
 * history (operator ruling Q4 = A), newest first, keyset-paged on
 * `(upper(duration), id)`. Same "hub event" filter as the WoW raids reads:
 * tagged to the hub, not cancelled, not a rescheduling-poll placeholder.
 * No access logic here.
 */

type Db = PostgresJsDatabase<typeof schema>;

const { events } = schema;

const at = (d: Date): SQL => sql`${d.toISOString()}::timestamp`;

/**
 * Sort key, truncated to the millisecond a JS `Date` (and so the cursor)
 * carries — otherwise a microsecond end time could repeat or skip a row.
 */
const endsKey = sql`date_trunc('milliseconds', upper(${events.duration}))`;

function hubEndedEvents(guildId: number, now: Date): SQL | undefined {
  return and(
    eq(events.guildId, guildId),
    isNull(events.cancelledAt),
    isNull(events.reschedulingPollId),
    sql`upper(${events.duration}) <= ${at(now)}`,
  );
}

/** Strictly older than the cursor's `(ends, id)`; no cursor = no bound. */
function olderThan(cursor: PastCursor | null): SQL | undefined {
  if (cursor === null) return undefined;
  return sql`(${endsKey}, ${events.id}) < (${at(cursor.endsAt)}, ${cursor.id})`;
}

/** One page (fixed size) of the hub's ended events, plus the next cursor. */
export async function loadPastEventsPage(
  db: Db,
  guildId: number,
  cursor: PastCursor | null,
  now: Date,
): Promise<GuildPastEventsPageDto> {
  const rows: RecentRow[] = await db
    .select(recentFields())
    .from(events)
    .where(and(hubEndedEvents(guildId, now), olderThan(cursor)))
    .orderBy(desc(endsKey), desc(events.id))
    .limit(GUILD_PAST_EVENTS_PAGE_SIZE + 1);
  const page = rows.slice(0, GUILD_PAST_EVENTS_PAGE_SIZE);
  const last = page[page.length - 1];
  const more = rows.length > GUILD_PAST_EVENTS_PAGE_SIZE && last !== undefined;
  return {
    events: page.map(toRecentCard),
    nextCursor: more
      ? encodePastCursor({ endsAt: last.duration[1], id: last.id })
      : null,
  };
}

/**
 * ROK-1595 G-1 (S4): mark the viewer's own event blocks that we hold a
 * synced copy of on their external calendar (ROK-1596 write sync), so the
 * grid can say "also on Google Calendar". Read from `calendar_event_links`
 * (state `synced`, the viewer's own rows only) joined to the connection for
 * the provider. Kill switch off, or no link → the block is returned as is.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CalendarProviderSchema,
  type CalendarProvider,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { readCalendarSyncEnabled } from '../calendar-sync/read/calendar-sync-enabled.query';
import type { EventBlockDescriptor } from './game-time.types';

type Db = PostgresJsDatabase<typeof schema>;

/** eventId → the provider of the viewer's synced copy (first link wins). */
async function syncedCopyProviders(
  db: Db,
  userId: number,
  eventIds: number[],
): Promise<Map<number, CalendarProvider>> {
  const { calendarEventLinks: links, calendarConnections: conns } = schema;
  const rows = await db
    .select({ eventId: links.eventId, provider: conns.provider })
    .from(links)
    .innerJoin(conns, eq(conns.id, links.connectionId))
    .where(
      and(
        eq(links.userId, userId),
        inArray(links.eventId, eventIds),
        eq(links.state, 'synced'),
        ne(conns.status, 'disconnecting'),
      ),
    )
    .orderBy(links.connectionId);
  const byEvent = new Map<number, CalendarProvider>();
  for (const row of rows) {
    const provider = CalendarProviderSchema.safeParse(row.provider);
    if (provider.success && !byEvent.has(row.eventId)) {
      byEvent.set(row.eventId, provider.data);
    }
  }
  return byEvent;
}

/**
 * The viewer's event blocks, each with `calendarCopy` set when a synced copy
 * exists. `userId` must be the viewer: links are read for that user only.
 */
export async function attachCalendarCopies(
  db: Db,
  userId: number,
  events: EventBlockDescriptor[],
): Promise<EventBlockDescriptor[]> {
  if (events.length === 0) return events;
  if (!(await readCalendarSyncEnabled(db))) return events;
  const ids = [...new Set(events.map((e) => e.eventId))];
  const copies = await syncedCopyProviders(db, userId, ids);
  if (copies.size === 0) return events;
  return events.map((e) => {
    const provider = copies.get(e.eventId);
    return provider ? { ...e, calendarCopy: provider } : e;
  });
}

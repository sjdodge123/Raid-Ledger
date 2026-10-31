/**
 * ROK-1597 Codex P1: a dedicated "Raid Ledger" calendar can be SHARED by two
 * connections. Microsoft (and Apple) adopt an existing "Raid Ledger" calendar
 * by name, so two Raid Ledger users who connect the same remote account end
 * up pointing at one calendar. Deleting it would wipe the other user's copies.
 *
 * Every path that deletes a dedicated calendar (disconnect, write-off, a lost
 * claim race) therefore deletes OUR copies one by one first and then calls
 * `deleteCalendarIfExclusive`, which removes the calendar only when no other
 * connection row of the same provider still references it — neither as its
 * `dedicated_calendar_id` nor through a live copy link. A row that is itself
 * `disconnecting` does not count: its job is removing its copies anyway, and
 * counting it would let two concurrent disconnects each leave the calendar.
 */
import { and, eq, ne, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { NotFoundError } from '../providers/calendar-provider.errors';
import type {
  CalendarCredentials,
  CalendarWriteCapability,
} from '../providers/calendar-provider.interface';

type Db = PostgresJsDatabase<typeof schema>;

/** The parts of a connection row the reference check needs. */
export interface CalendarOwnerRef {
  id: number;
  provider: string;
}

/** Rows of the same provider other than `owner`, not themselves leaving. */
function siblingsOf(owner: CalendarOwnerRef): SQL | undefined {
  const t = schema.calendarConnections;
  return and(
    ne(t.id, owner.id),
    eq(t.provider, owner.provider),
    ne(t.status, 'disconnecting'),
  );
}

/** A sibling row whose live copy link sits in `calendarId`. */
async function linkedElsewhere(
  db: Db,
  owner: CalendarOwnerRef,
  calendarId: string,
): Promise<boolean> {
  const t = schema.calendarConnections;
  const links = schema.calendarEventLinks;
  const [row] = await db
    .select({ id: links.id })
    .from(links)
    .innerJoin(t, eq(links.connectionId, t.id))
    .where(
      and(
        siblingsOf(owner),
        eq(links.calendarId, calendarId),
        ne(links.state, 'suppressed'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** True when another live connection still uses `calendarId` (see header). */
export async function calendarUsedElsewhere(
  db: Db,
  owner: CalendarOwnerRef,
  calendarId: string,
): Promise<boolean> {
  const t = schema.calendarConnections;
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(siblingsOf(owner), eq(t.dedicatedCalendarId, calendarId)))
    .limit(1);
  return Boolean(row) || linkedElsewhere(db, owner, calendarId);
}

/**
 * Delete the dedicated calendar only when no other connection uses it (a 404
 * is success). Call AFTER this connection's own copies are deleted.
 * @returns true when the calendar was deleted (or already gone).
 */
export async function deleteCalendarIfExclusive(
  db: Db,
  owner: CalendarOwnerRef,
  provider: Pick<CalendarWriteCapability, 'deleteRaidLedgerCalendar'>,
  creds: CalendarCredentials,
  calendarId: string,
): Promise<boolean> {
  if (await calendarUsedElsewhere(db, owner, calendarId)) return false;
  try {
    await provider.deleteRaidLedgerCalendar(creds, calendarId);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
  return true;
}

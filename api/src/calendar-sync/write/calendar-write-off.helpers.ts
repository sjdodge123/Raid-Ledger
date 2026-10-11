/**
 * ROK-1596 D6 / Q5 / F8: the `write-off` job body — sending was switched off.
 *
 * Under fresh credentials: delete every non-suppressed link's copy (a 404 is
 * success), each link row right after its copy so a retried job resumes;
 * then delete the dedicated "Raid Ledger" calendar and null its id; finally
 * drop the remaining (suppressed) link rows so a later re-enable starts clean.
 *
 * Skipped when the connection is gone or sending is back on by the time the
 * job runs (the re-enable's reconciles own the copies then). A
 * `ProviderAuthError` flips the connection to `needs_reconnect` and keeps
 * the link rows — reconcile after a reconnect sees write off + a link and
 * deletes the copy. Rate-limit / transient errors rethrow for BullMQ retry.
 */
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  NotFoundError,
  ProviderAuthError,
} from '../providers/calendar-provider.errors';
import type { CalendarCredentials } from '../providers/calendar-provider.interface';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { withFreshCredentials } from '../services/calendar-credentials.helpers';
import { errorCode } from './calendar-write-reconcile.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;
type WriteProvider = NonNullable<
  Awaited<ReturnType<CalendarProviderRegistry['getWriteProviderForConnection']>>
>;

export interface CalendarWriteOffDeps {
  db: Db;
  registry: Pick<CalendarProviderRegistry, 'getWriteProviderForConnection'>;
}

export type WriteOffOutcome =
  | { result: 'noop'; reason: 'connection_missing' | 'write_enabled' }
  | { result: 'noop'; reason: 'no_write_provider' }
  | { result: 'done'; deletedCopies: number }
  | { result: 'failed'; reason: string };

/** Run one write-off for `connectionId` (see file header). */
export async function runCalendarWriteOff(
  deps: CalendarWriteOffDeps,
  connectionId: number,
): Promise<WriteOffOutcome> {
  const t = schema.calendarConnections;
  const [conn] = await deps.db.select().from(t).where(eq(t.id, connectionId));
  if (!conn) return { result: 'noop', reason: 'connection_missing' };
  if (conn.writeEnabled) return { result: 'noop', reason: 'write_enabled' };
  const provider = await deps.registry.getWriteProviderForConnection(conn);
  if (!provider) return { result: 'noop', reason: 'no_write_provider' };
  try {
    return await withFreshCredentials(deps.db, conn, provider, (creds) =>
      writeOff(deps.db, conn, provider, creds),
    );
  } catch (err) {
    if (!(err instanceof ProviderAuthError)) throw err;
    const code = errorCode(err);
    await deps.db
      .update(t)
      .set({ status: 'needs_reconnect', lastErrorCode: code })
      .where(eq(t.id, connectionId));
    return { result: 'failed', reason: code };
  }
}

async function writeOff(
  db: Db,
  conn: ConnectionRow,
  provider: WriteProvider,
  creds: CalendarCredentials,
): Promise<WriteOffOutcome> {
  const links = schema.calendarEventLinks;
  const ofConn = eq(links.connectionId, conn.id);
  const live = await db
    .select()
    .from(links)
    .where(and(ofConn, ne(links.state, 'suppressed')));
  for (const link of live) {
    const { calendarId, providerEventId } = link;
    await provider.deleteEvent(creds, { calendarId, providerEventId });
    await db.delete(links).where(eq(links.id, link.id));
  }
  if (conn.dedicatedCalendarId) {
    await deleteCalendar(provider, creds, conn.dedicatedCalendarId);
    await db
      .update(schema.calendarConnections)
      .set({ dedicatedCalendarId: null, updatedAt: new Date() })
      .where(eq(schema.calendarConnections.id, conn.id));
  }
  await db.delete(links).where(ofConn);
  return { result: 'done', deletedCopies: live.length };
}

/** A calendar already gone remotely is the outcome we wanted. */
async function deleteCalendar(
  provider: WriteProvider,
  creds: CalendarCredentials,
  calendarId: string,
): Promise<void> {
  try {
    await provider.deleteRaidLedgerCalendar(creds, calendarId);
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
}

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
 * the link rows and `dedicated_calendar_id`: "write off + a calendar id or a
 * live link" IS the unfinished-write-off marker, and the reconnect calls
 * `enqueuePendingWriteOff` to run the job again (review m3). A
 * `ProviderRequestError` (permanent 4xx) ends the job `failed` without a
 * retry (m6). Rate-limit / transient errors rethrow for BullMQ retry.
 */
import { and, eq, isNotNull, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
} from '../providers/calendar-provider.errors';
import type { CalendarCredentials } from '../providers/calendar-provider.interface';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { withFreshCredentials } from '../services/calendar-credentials.helpers';
import { errorCode } from './calendar-write-reconcile.helpers';
import {
  enqueueCalendarWriteJob,
  type CalendarWriteEnqueueDeps,
  type EnqueueResult,
} from './calendar-write.enqueue.helpers';

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
    if (err instanceof ProviderRequestError) {
      return { result: 'failed', reason: errorCode(err) };
    }
    if (!(err instanceof ProviderAuthError)) throw err;
    const code = errorCode(err);
    await deps.db
      .update(t)
      .set({ status: 'needs_reconnect', lastErrorCode: code })
      .where(eq(t.id, connectionId));
    return { result: 'failed', reason: code };
  }
}

/** Each non-suppressed link's copy, then its row (resumable per link). */
async function deleteLiveCopies(
  db: Db,
  connectionId: number,
  provider: WriteProvider,
  creds: CalendarCredentials,
): Promise<number> {
  const links = schema.calendarEventLinks;
  const live = await db
    .select()
    .from(links)
    .where(
      and(eq(links.connectionId, connectionId), ne(links.state, 'suppressed')),
    );
  let deleted = 0;
  for (const { id, calendarId, providerEventId } of live) {
    // A `failed` placeholder ('' ids) has no copy behind it: row only.
    if (providerEventId) {
      await provider.deleteEvent(creds, { calendarId, providerEventId });
      deleted += 1;
    }
    await db.delete(links).where(eq(links.id, id));
  }
  return deleted;
}

async function writeOff(
  db: Db,
  conn: ConnectionRow,
  provider: WriteProvider,
  creds: CalendarCredentials,
): Promise<WriteOffOutcome> {
  const links = schema.calendarEventLinks;
  const ofConn = eq(links.connectionId, conn.id);
  const deletedCopies = await deleteLiveCopies(db, conn.id, provider, creds);
  if (conn.dedicatedCalendarId) {
    await deleteCalendar(provider, creds, conn.dedicatedCalendarId);
    await db
      .update(schema.calendarConnections)
      .set({ dedicatedCalendarId: null, updatedAt: new Date() })
      .where(eq(schema.calendarConnections.id, conn.id));
  }
  // Only the suppressed rows: a link written after `live` was read (a
  // concurrent reconcile) keeps its row, so its copy is not orphaned (m2).
  await db.delete(links).where(and(ofConn, eq(links.state, 'suppressed')));
  return { result: 'done', deletedCopies };
}

/**
 * Review m3: true when a write-off for `connectionId` stopped part-way (an
 * auth error) — sending is off but a dedicated calendar id or a live link
 * row is still there.
 */
export async function hasPendingWriteOff(
  db: Db,
  connectionId: number,
): Promise<boolean> {
  const t = schema.calendarConnections;
  const links = schema.calendarEventLinks;
  const liveLink = sql`exists (select 1 from ${links} where ${links.connectionId} = ${t.id} and ${links.state} <> 'suppressed')`;
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.id, connectionId),
        eq(t.writeEnabled, false),
        or(isNotNull(t.dedicatedCalendarId), liveLink),
      ),
    );
  return Boolean(row);
}

/**
 * Review m3: call after a reconnect (credentials stored, status `active`):
 * re-queues the write-off a `ProviderAuthError` interrupted, so the
 * dedicated calendar and every remaining copy are cleaned. null = nothing
 * pending.
 */
export async function enqueuePendingWriteOff(
  db: Db,
  deps: CalendarWriteEnqueueDeps,
  connectionId: number,
): Promise<EnqueueResult | null> {
  if (!(await hasPendingWriteOff(db, connectionId))) return null;
  return enqueueCalendarWriteJob(deps, { kind: 'write-off', connectionId });
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

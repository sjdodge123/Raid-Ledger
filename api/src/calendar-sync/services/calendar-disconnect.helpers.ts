/**
 * ROK-1592 → ROK-1596 D7 (Q5, F2): disconnect one connection.
 *
 * The request only marks the caller's row `disconnecting` (the overview hides
 * it at once) and queues a `disconnect` job. The job body
 * (`runCalendarDisconnect`) then, for a row still `disconnecting`:
 * 1. under fresh credentials, deletes our copies outside the dedicated
 *    calendar (the primary-target ones; a 404 is success),
 * 2. deletes the dedicated "Raid Ledger" calendar (its copies go with it),
 * 3. deletes the row (event links cascade),
 * 4. revokes best-effort with the stored credentials.
 *
 * Only a retryable error (`TransientError` / `RateLimitError`) while BullMQ
 * attempts remain rethrows, with the row kept. Anything else — auth loss,
 * unreadable credentials, a permanent refusal, an unknown error, or a
 * retryable one on the FINAL attempt — skips the remote cleanup and the row is
 * still deleted (review M1: a row must never stay `disconnecting` holding a
 * refresh token). `CalendarDisconnectSweepCron` re-queues stale rows whose job
 * was lost (Redis down at DELETE, a crash).
 *
 * The revoke is SKIPPED while another row still has the same `(provider,
 * account_subject)`: two RL users may connect one Google account, and a
 * revoke would kill both grants (U8). Deleting BEFORE counting the remaining
 * rows makes two concurrent disconnects of one account safe: the last one to
 * delete always sees zero and revokes (a double revoke is harmless). A revoke
 * failure is logged with its error code only. Independent of the kill
 * switch (Lead ruling on Q-E): a user can always remove stored credentials.
 */
import { Logger } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import {
  CalendarProviderError,
  NotFoundError,
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../providers/calendar-provider.errors';
import type { CalendarCredentials } from '../providers/calendar-provider.interface';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import {
  purgeConnectionBusyBlocks,
  purgeConnectionCalendarAbsences,
} from '../read/calendar-read-purge.helpers';
import {
  CalendarCredentialsUnreadableError,
  decryptCalendarCredentials,
  withFreshCredentials,
} from './calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ConnectionRow = typeof calendarConnections.$inferSelect;
type WriteProvider = NonNullable<
  Awaited<ReturnType<CalendarProviderRegistry['getWriteProviderForConnection']>>
>;

export type CalendarDisconnectRegistry = Pick<
  CalendarProviderRegistry,
  'getAccountProviderForConnection' | 'getWriteProviderForConnection'
>;

export interface CalendarDisconnectDeps {
  db: Db;
  registry: CalendarDisconnectRegistry;
}

export type CalendarRevokeOutcome =
  'revoked' | 'skipped_sibling' | 'skipped_no_provider' | 'failed';

export type RemoteCleanupOutcome =
  'cleaned' | 'skipped_auth' | 'skipped_error' | 'skipped_no_provider';

export interface CalendarDisconnectOptions {
  /** No BullMQ retry follows: never rethrow, always delete the row. */
  finalAttempt?: boolean;
}

/** `found: false` = the row is gone, or no longer `disconnecting`. */
export type CalendarDisconnectResult =
  | { found: false }
  | {
      found: true;
      remote: RemoteCleanupOutcome;
      revoke: CalendarRevokeOutcome;
    };

const logger = new Logger('CalendarDisconnect');

/**
 * The request half: flag the caller's own row and (ROK-1593 D-R7, §6.4.4)
 * delete its busy blocks in the same transaction, so busy hours stop counting
 * before the response. PR-B also deletes its synced (`source='calendar'`)
 * absences here — the row survives as `disconnecting`, so the FK cascade
 * only fires later. The CALLER enqueues a `derive` after commit, which
 * rebuilds any day another connection still covers (Q16). False → 404.
 */
export async function markCalendarDisconnecting(
  db: Db,
  input: { userId: number; connectionId: number },
): Promise<boolean> {
  const t = calendarConnections;
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(t)
      .set({ status: 'disconnecting', updatedAt: new Date() })
      .where(and(eq(t.id, input.connectionId), eq(t.userId, input.userId)))
      .returning({ id: t.id });
    if (rows.length === 0) return false;
    await purgeConnectionBusyBlocks(tx, input.connectionId);
    await purgeConnectionCalendarAbsences(tx, input.connectionId);
    return true;
  });
}

async function loadRow(db: Db, id: number): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, id))
    .limit(1);
  return row ?? null;
}

/** Any row left with this account, AFTER the row was deleted. */
async function accountStillHeld(db: Db, row: ConnectionRow): Promise<boolean> {
  const remaining = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.provider, row.provider),
        eq(calendarConnections.accountSubject, row.accountSubject),
      ),
    )
    .limit(1);
  return remaining.length > 0;
}

/** A log-safe code: never an error message, which may echo a response body. */
function errorCode(err: unknown): string {
  if (err instanceof CalendarProviderError) return `${err.code}:${err.reason}`;
  return err instanceof Error ? err.name : 'unknown';
}

async function ignoreNotFound(op: Promise<void>): Promise<void> {
  try {
    await op;
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
  }
}

async function deleteRemote(
  db: Db,
  row: ConnectionRow,
  provider: WriteProvider,
  creds: CalendarCredentials,
): Promise<void> {
  const links = schema.calendarEventLinks;
  const refs = await db
    .select({
      calendarId: links.calendarId,
      providerEventId: links.providerEventId,
    })
    .from(links)
    .where(and(eq(links.connectionId, row.id), ne(links.state, 'suppressed')));
  for (const ref of refs) {
    if (!ref.providerEventId) continue; // E1 undo placeholder: no copy
    if (ref.calendarId === row.dedicatedCalendarId) continue;
    await ignoreNotFound(provider.deleteEvent(creds, ref));
  }
  const dedicated = row.dedicatedCalendarId;
  if (dedicated) {
    await ignoreNotFound(provider.deleteRaidLedgerCalendar(creds, dedicated));
  }
}

const isRetryable = (err: unknown) =>
  err instanceof TransientError || err instanceof RateLimitError;

const isAuthLost = (err: unknown) =>
  err instanceof ProviderAuthError ||
  err instanceof CalendarCredentialsUnreadableError;

async function cleanRemote(
  deps: CalendarDisconnectDeps,
  row: ConnectionRow,
  opts: CalendarDisconnectOptions,
): Promise<RemoteCleanupOutcome> {
  try {
    const provider = await deps.registry.getWriteProviderForConnection(row);
    if (!provider) return 'skipped_no_provider';
    await withFreshCredentials(deps.db, row, provider, (creds) =>
      deleteRemote(deps.db, row, provider, creds),
    );
    return 'cleaned';
  } catch (err) {
    if (isRetryable(err) && !opts.finalAttempt) throw err;
    logger.warn(
      `calendar cleanup skipped for connection ${row.id} (${errorCode(err)})`,
    );
    return isAuthLost(err) ? 'skipped_auth' : 'skipped_error';
  }
}

async function revokeBestEffort(
  registry: CalendarDisconnectRegistry,
  row: ConnectionRow,
): Promise<CalendarRevokeOutcome> {
  try {
    const provider = await registry.getAccountProviderForConnection(row);
    if (!provider) return 'skipped_no_provider';
    await provider.disconnect(
      decryptCalendarCredentials(row.credentialsEncrypted),
    );
    return 'revoked';
  } catch (err) {
    logger.warn(
      `calendar revoke failed for connection ${row.id} (${errorCode(err)})`,
    );
    return 'failed';
  }
}

/** The `disconnect` job body (see file header). */
export async function runCalendarDisconnect(
  deps: CalendarDisconnectDeps,
  connectionId: number,
  opts: CalendarDisconnectOptions = {},
): Promise<CalendarDisconnectResult> {
  const row = await loadRow(deps.db, connectionId);
  if (!row || row.status !== 'disconnecting') return { found: false };
  const remote = await cleanRemote(deps, row, opts);
  await deps.db
    .delete(calendarConnections)
    .where(eq(calendarConnections.id, row.id));
  const revoke = (await accountStillHeld(deps.db, row))
    ? 'skipped_sibling'
    : await revokeBestEffort(deps.registry, row);
  return { found: true, remote, revoke };
}

/**
 * ROK-1596 review fixes (B1, M2, m4): the reconcile's DB writes, each one
 * race-safe against a concurrent reconcile or an Undo.
 *
 * - `claimDedicatedCalendar` compare-and-swaps the connection's dedicated
 *   calendar id, so two reconciles that each created a calendar agree on one.
 * - `saveLink` / `markLinkFailed` never overwrite a `suppressed` link (Undo
 *   landed mid-flight) — `saveLink` reports the skip so the caller can delete
 *   the copy it just made.
 * - `handleFailure` records terminal failures (and the last attempt of a
 *   retryable one) as a `failed` link, even when no link row existed yet.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  CalendarProviderError,
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
} from '../providers/calendar-provider.errors';
import type { CopyRef } from '../providers/calendar-provider.interface';

type Db = PostgresJsDatabase<typeof schema>;

export interface LinkKey {
  connectionId: number;
  eventId: number;
  userId: number;
}

export type FailureOutcome = { result: 'failed'; reason: string };

const logger = new Logger('CalendarWriteReconcile');

/** Log-safe, column-sized code: never an error message (may echo a body). */
export function errorCode(err: unknown): string {
  if (err instanceof CalendarProviderError)
    return `${err.code}:${err.reason}`.slice(0, 64);
  return err instanceof Error ? err.name.slice(0, 64) : 'unknown';
}

/** BullMQ: true when this run is the job's last attempt (no retry follows). */
export function isFinalAttempt(job: {
  attemptsMade?: number;
  opts?: { attempts?: number };
}): boolean {
  return (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
}

/**
 * B1: set the dedicated calendar id only if it is still `expected`. Returns
 * the id the connection holds afterwards — `next` when this call won, the
 * concurrent winner's id when it lost.
 */
export async function claimDedicatedCalendar(
  db: Db,
  connectionId: number,
  expected: string | null,
  next: string,
): Promise<string> {
  const t = schema.calendarConnections;
  const unchanged =
    expected === null
      ? isNull(t.dedicatedCalendarId)
      : eq(t.dedicatedCalendarId, expected);
  const won = await db
    .update(t)
    .set({ dedicatedCalendarId: next, updatedAt: new Date() })
    .where(and(eq(t.id, connectionId), unchanged))
    .returning({ id: t.id });
  if (won.length > 0) return next;
  const [row] = await db
    .select({ id: t.dedicatedCalendarId })
    .from(t)
    .where(eq(t.id, connectionId))
    .limit(1);
  // Cleared meanwhile (write-off) — nothing to agree with, so claim it.
  if (!row?.id) return claimDedicatedCalendar(db, connectionId, null, next);
  return row.id;
}

function upsertLink(
  db: Db,
  key: LinkKey,
  fields: Partial<typeof schema.calendarEventLinks.$inferInsert>,
  insertIds: { calendarId: string; providerEventId: string },
) {
  const t = schema.calendarEventLinks;
  return db
    .insert(t)
    .values({ ...key, ...insertIds, ...fields })
    .onConflictDoUpdate({
      target: [t.connectionId, t.eventId, t.userId],
      set: fields,
      setWhere: ne(t.state, 'suppressed'),
    })
    .returning({ id: t.id });
}

/** M2: false when the link was suppressed meanwhile (nothing written). */
export async function saveLink(
  db: Db,
  key: LinkKey,
  ref: CopyRef,
): Promise<boolean> {
  const ids = {
    calendarId: ref.calendarId,
    providerEventId: ref.providerEventId,
  };
  const fields = {
    ...ids,
    etag: ref.etag ?? null,
    state: 'synced',
    lastErrorCode: null,
    updatedAt: new Date(),
  };
  const written = await upsertLink(db, key, fields, ids);
  return written.length > 0;
}

/** m4: a `failed` link — a placeholder ('' ids) when none existed yet. */
async function markLinkFailed(db: Db, key: LinkKey, code: string) {
  const fields = {
    state: 'failed',
    lastErrorCode: code,
    updatedAt: new Date(),
  };
  await upsertLink(db, key, fields, { calendarId: '', providerEventId: '' });
}

/** m4: retries exhausted — alert without the error message or any body. */
function reportExhausted(key: LinkKey, code: string): void {
  Sentry.captureException(new Error('calendar write retries exhausted'), {
    tags: { area: 'calendar-write', code },
    extra: { connectionId: key.connectionId, eventId: key.eventId },
  });
}

function markNeedsReconnect(db: Db, connectionId: number, code: string) {
  return db
    .update(schema.calendarConnections)
    .set({
      status: 'needs_reconnect',
      lastErrorCode: code,
      updatedAt: new Date(),
    })
    .where(eq(schema.calendarConnections.id, connectionId));
}

/**
 * Terminal failures are recorded and swallowed; retryable ones are rethrown
 * — on the final attempt after being recorded and reported (m4).
 */
export async function handleFailure(
  db: Db,
  key: LinkKey,
  err: unknown,
  finalAttempt: boolean,
): Promise<FailureOutcome> {
  const auth = err instanceof ProviderAuthError;
  const terminal =
    auth || err instanceof ProviderRequestError || err instanceof NotFoundError;
  if (!terminal && !finalAttempt) throw err;
  const code = errorCode(err);
  if (auth) await markNeedsReconnect(db, key.connectionId, code);
  await markLinkFailed(db, key, code);
  logger.warn(
    `calendar copy failed for connection ${key.connectionId} (${code})`,
  );
  if (!terminal) {
    reportExhausted(key, code);
    throw err;
  }
  return { result: 'failed', reason: code };
}

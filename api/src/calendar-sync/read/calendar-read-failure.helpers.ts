/**
 * ROK-1593 A5 (pre-plan D5 / D11, epic §4.4.2 step 9): what a failed read
 * sync does to its connection. The processor (A6) calls
 * `recordReadSyncFailure` in its catch and rethrows when `retry` is true.
 *
 * - 403 scope → `read_access_granted` / `read_enabled` off, `read_scopes`,
 *   no retry (the user re-grants from the page).
 * - Other auth → `needs_reconnect`, `auth`, no retry.
 * - Rate limit → retry no sooner than `retryAfterMs`.
 * - 400-class refusal / missing OAuth client → `provider_error`, no retry.
 * - Anything else → `provider_error`, retry; after the final attempt only
 *   `last_error_code` and a backed-off `next_sync_at` are written: 1 h →
 *   2 h → 4 h → capped 6 h (stateless: the gap since the last success picks
 *   the step once a transient code is already recorded).
 *
 * A transient read failure NEVER touches `status`: it is shared with the
 * ROK-1596 write fan-out and reconcile cron, which only pick `active` rows,
 * so a Google read hiccup must not stop write sync. The connection stays
 * `active`, its blocks from the last good sync keep counting, and the read
 * cron re-picks it once `next_sync_at` passes. Auth failure still goes
 * `needs_reconnect` (a broken token breaks writes too).
 *
 * `last_error_code` is always one of the closed `CalendarSyncErrorCode`
 * values — never a provider message.
 */
import type { CalendarSyncErrorCode } from '@raid-ledger/contract';
import { and, eq, ne } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  CalendarProviderError,
  ProviderAuthError,
  RateLimitError,
} from '../providers/calendar-provider.errors';

type Db = PostgresJsDatabase<typeof schema>;

const HOUR_MS = 60 * 60 * 1000;
export const READ_ERROR_BACKOFF_CAP_MS = 6 * HOUR_MS;

export interface ReadFailureDecision {
  code: CalendarSyncErrorCode;
  retry: boolean;
  /** Set for a rate limit: the earliest retry. */
  retryAfterMs?: number;
}

export type ReadFailureConnection = Pick<
  typeof schema.calendarConnections.$inferSelect,
  'id' | 'lastErrorCode' | 'lastSyncedAt' | 'createdAt'
>;

/** Codes a retryable read failure records; a repeat of one backs off. */
const TRANSIENT_READ_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',
]);

/** D5: map any thrown value to a closed error code + retry decision. */
export function classifyReadFailure(err: unknown): ReadFailureDecision {
  if (err instanceof ProviderAuthError) {
    const code = err.reason === 'scope' ? 'read_scopes' : 'auth';
    return { code, retry: false };
  }
  if (err instanceof RateLimitError) {
    return {
      code: 'rate_limited',
      retry: true,
      retryAfterMs: err.retryAfterMs,
    };
  }
  // A permanent refusal or a removed OAuth client cannot heal by retrying.
  const permanent =
    err instanceof CalendarProviderError &&
    (err.code === 'rejected' || err.code === 'not_configured');
  return { code: 'provider_error', retry: !permanent };
}

/** 1 h on the first exhausted failure, then doubling, capped at 6 h. */
export function readErrorBackoffMs(
  conn: Pick<
    ReadFailureConnection,
    'lastErrorCode' | 'lastSyncedAt' | 'createdAt'
  >,
  now: Date,
): number {
  if (!conn.lastErrorCode || !TRANSIENT_READ_CODES.has(conn.lastErrorCode)) {
    return HOUR_MS;
  }
  const since = (conn.lastSyncedAt ?? conn.createdAt).getTime();
  const hours = Math.max(1, (now.getTime() - since) / HOUR_MS);
  const step = 2 ** Math.ceil(Math.log2(hours)) * HOUR_MS;
  return Math.min(step, READ_ERROR_BACKOFF_CAP_MS);
}

function failureFields(
  decision: ReadFailureDecision,
  conn: ReadFailureConnection,
  opts: { finalAttempt: boolean; now: Date },
) {
  if (decision.code === 'read_scopes') {
    return { readAccessGranted: false, readEnabled: false };
  }
  if (decision.code === 'auth') return { status: 'needs_reconnect' };
  if (decision.retry && !opts.finalAttempt) return null;
  // No `status`: see the file header (writes keep running).
  const backoff = readErrorBackoffMs(conn, opts.now);
  return { nextSyncAt: new Date(opts.now.getTime() + backoff) };
}

/**
 * Which rows a failure may write. Auth / scope outcomes apply to any row
 * not being disconnected. A transient outcome applies only to an `active`
 * row: if the write side moved it to `needs_reconnect` mid-fetch, its
 * `auth` code must not be overwritten by `provider_error`/`rate_limited`.
 */
function failureTarget(decision: ReadFailureDecision, id: number) {
  const c = schema.calendarConnections;
  const transient = decision.code !== 'auth' && decision.code !== 'read_scopes';
  return transient
    ? and(eq(c.id, id), eq(c.status, 'active'))
    : and(eq(c.id, id), ne(c.status, 'disconnecting'));
}

/**
 * Record a failed sync on the connection (a non-final retryable attempt
 * writes nothing) and return the decision. Never touches a connection that
 * is `disconnecting` (see `failureTarget`).
 */
export async function recordReadSyncFailure(
  db: Db,
  conn: ReadFailureConnection,
  err: unknown,
  opts: { finalAttempt: boolean; now?: Date },
): Promise<ReadFailureDecision> {
  const now = opts.now ?? new Date();
  const decision = classifyReadFailure(err);
  const fields = failureFields(decision, conn, {
    finalAttempt: opts.finalAttempt,
    now,
  });
  if (!fields) return decision;
  const c = schema.calendarConnections;
  await db
    .update(c)
    .set({ ...fields, lastErrorCode: decision.code, updatedAt: now })
    .where(failureTarget(decision, conn.id));
  return decision;
}

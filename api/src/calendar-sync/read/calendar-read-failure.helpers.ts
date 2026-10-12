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
 * - Anything else → `provider_error`, retry; after the final attempt the
 *   connection goes `error` with `next_sync_at` backing off 1 h → 2 h → 4 h
 *   → capped 6 h (stateless: the gap since the last success picks the step).
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
  'id' | 'status' | 'lastSyncedAt' | 'createdAt'
>;

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
  conn: Pick<ReadFailureConnection, 'status' | 'lastSyncedAt' | 'createdAt'>,
  now: Date,
): number {
  if (conn.status !== 'error') return HOUR_MS;
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
  const backoff = readErrorBackoffMs(conn, opts.now);
  return {
    status: 'error',
    nextSyncAt: new Date(opts.now.getTime() + backoff),
  };
}

/**
 * Record a failed sync on the connection (a non-final retryable attempt
 * writes nothing) and return the decision. Never touches a connection that
 * is `disconnecting`.
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
    .where(and(eq(c.id, conn.id), ne(c.status, 'disconnecting')));
  return decision;
}

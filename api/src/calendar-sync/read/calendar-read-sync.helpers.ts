/**
 * ROK-1593 A5 (epic ROK-669 §4.4.2 steps 3–8, spec §3.3): one read sync of
 * one connection. No queue here — the processor (A6) resolves the provider,
 * calls `runCalendarReadSync`, and on a throw calls `recordReadSyncFailure`
 * (`calendar-read-failure.helpers.ts`).
 *
 * - Window = local midnight today in the user's zone + LOOK_AHEAD_DAYS.
 * - **R1:** `read_calendar_ids` (or `primary`) minus `dedicated_calendar_id`
 *   minus every `listCalendars` row flagged `isRaidLedger` — the Raid Ledger
 *   calendar is never fetched.
 * - One transaction replaces the connection's blocks from the window start
 *   on, runs the `afterBlocks` hook (PR-B derives away days; no-op here) and
 *   stamps the connection. A connection that left `active` (disconnecting,
 *   or `needs_reconnect` set by the write queue) or lost `read_enabled`
 *   meanwhile is left untouched (row lock + re-check). The kill switch is
 *   re-checked AFTER the lock too: the switch-off purge locks the same rows
 *   (`purgeAllCalendarReadData`), so a sync either commits before the purge
 *   (which then deletes its blocks) or sees the switch off.
 * - **Lock order:** when `afterBlocks` derives, the per-user
 *   advisory lock is taken BEFORE the row lock (`lockForSync`), the same
 *   order as `runCalendarDerive` — see `calendar-away-guard.helpers.ts`.
 * - `missingCalendarIds` (404/410 calendars) are pruned from the LOCKED
 *   row's `read_calendar_ids`, so a settings PUT racing the fetch survives.
 * - A calendar refused by a policy 403 (`unreadableCalendarIds`) is
 *   skipped, never pruned: the rest commit and `last_error_code` is set to
 *   `provider_error` so the user can tell a calendar is failing.
 * - A success never writes `status` (it is shared with the write side).
 *
 * PRIVACY (§6.4.2): only instants and dates are written; no calendar id,
 * title or provider message is logged or stored.
 */
import { and, eq, gt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { resolveUserTimezone } from '../../notifications/timezone.helpers';
import type {
  FetchBusyResult,
  ProviderCalendar,
} from '../providers/calendar-provider.interface';
import type { CalendarReadProvider } from '../providers/calendar-provider.registry';
import { deriveInstanceId } from '../providers/rl-copy-id.helpers';
import { withFreshCredentials } from '../services/calendar-credentials.helpers';
import { lockUserDerive } from './calendar-away-guard.helpers';
import {
  buildReadWindow,
  normalizeBusyBlocks,
  type NormalizedBusyBlock,
  type ReadWindow,
} from './calendar-read-normalize.helpers';

type Db = PostgresJsDatabase<typeof schema>;
export type ReadSyncTx = Parameters<Parameters<Db['transaction']>[0]>[0];

type ConnectionRow = typeof schema.calendarConnections.$inferSelect;
export type ReadSyncConnection = Pick<
  ConnectionRow,
  | 'id'
  | 'userId'
  | 'credentialsEncrypted'
  | 'readCalendarIds'
  | 'dedicatedCalendarId'
>;

/** D7: next sync 30 min out, ± 5 min jitter. */
export const READ_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const READ_SYNC_JITTER_MS = 5 * 60 * 1000;
const PRIMARY_CALENDAR = 'primary';

export interface ReadSyncDeps {
  db: Db;
  provider: CalendarReadProvider;
  /** `SettingsService.getClientUrl()` — its host is the R2 instance id. */
  clientUrl: string;
  /** `app_settings.default_timezone` (or 'UTC'). */
  defaultTimezone: string;
  now?: () => Date;
  random?: () => number;
  /** Kill-switch re-check right before the write transaction (§3.7). */
  stillAllowed?: () => Promise<boolean>;
  /** PR-B: `runCalendarDerive(tx, userId)`. PR-A: no-op. */
  afterBlocks?: (tx: ReadSyncTx, userId: number) => Promise<void>;
  /** After commit: `GameTimeService.invalidateUserCache(userId)`. */
  onCommitted?: (userId: number) => void | Promise<void>;
}

/** `unchanged` = provider cursor hit (Apple); `skipped` = nothing written. */
export type ReadSyncOutcome = 'synced' | 'unchanged' | 'skipped';

export function nextReadSyncAt(now: Date, random: () => number): Date {
  const jitter = Math.round((random() * 2 - 1) * READ_SYNC_JITTER_MS);
  return new Date(now.getTime() + READ_SYNC_INTERVAL_MS + jitter);
}

/** R1: the calendars to fetch; the Raid Ledger calendar never appears. */
export function selectReadCalendarIds(
  conn: Pick<ReadSyncConnection, 'readCalendarIds' | 'dedicatedCalendarId'>,
  calendars: readonly ProviderCalendar[],
): string[] {
  const excluded = new Set(
    calendars.filter((c) => c.isRaidLedger).map((c) => c.id),
  );
  if (conn.dedicatedCalendarId) excluded.add(conn.dedicatedCalendarId);
  const wanted =
    conn.readCalendarIds.length > 0 ? conn.readCalendarIds : [PRIMARY_CALENDAR];
  return [...new Set(wanted)].filter((id) => !excluded.has(id));
}

/** D5: drop calendars the provider reported gone (404/410). */
export function pruneReadCalendarIds(
  current: readonly string[],
  missing: readonly string[],
): string[] {
  const gone = new Set(missing);
  return current.filter((id) => !gone.has(id));
}

/** An unknown IANA zone in a preference row falls back to UTC. */
export function safeReadWindow(now: Date, timeZone: string): ReadWindow {
  try {
    return buildReadWindow(now, timeZone);
  } catch {
    return buildReadWindow(now, 'UTC');
  }
}

function fetchWindow(
  deps: ReadSyncDeps,
  conn: ReadSyncConnection,
  window: ReadWindow,
): Promise<FetchBusyResult> {
  const range = { start: window.start, end: window.end };
  return withFreshCredentials(deps.db, conn, deps.provider, async (creds) => {
    const calendars = await deps.provider.listCalendars(creds);
    const ids = selectReadCalendarIds(conn, calendars);
    if (ids.length === 0) return { blocks: [] };
    return deps.provider.fetchBusy(creds, range, ids);
  });
}

/**
 * Row lock: a disconnect / `needs_reconnect` / read-off since the fetch wins
 * over the sync. Returns the locked row's CURRENT `read_calendar_ids`.
 */
async function lockReadable(
  tx: ReadSyncTx,
  id: number,
): Promise<{ readCalendarIds: string[] } | null> {
  const c = schema.calendarConnections;
  const [row] = await tx
    .select({
      status: c.status,
      readEnabled: c.readEnabled,
      readCalendarIds: c.readCalendarIds,
    })
    .from(c)
    .where(eq(c.id, id))
    .for('update');
  if (!row || row.status !== 'active' || !row.readEnabled) return null;
  return { readCalendarIds: row.readCalendarIds };
}

/**
 * LOCK ORDER RULE: advisory(user) → own row `FOR UPDATE` →
 * (inside the derive) `FOR KEY SHARE` on all of the user's rows. A derive
 * job takes advisory → rows; if the sync took its row first and then waited
 * on the advisory lock, the two would deadlock (40P01). So when this sync
 * will derive (`withDerive`), take the advisory lock FIRST. The derive's own
 * `pg_advisory_xact_lock` inside `afterBlocks` runs on this same `tx`, and
 * the lock is re-entrant per session, so it does not wait.
 */
export async function lockForSync(
  tx: ReadSyncTx,
  conn: Pick<ReadSyncConnection, 'id' | 'userId'>,
  withDerive: boolean,
): Promise<{ readCalendarIds: string[] } | null> {
  if (withDerive) await lockUserDerive(tx, conn.userId);
  return lockReadable(tx, conn.id);
}

async function replaceBlocks(
  tx: ReadSyncTx,
  conn: ReadSyncConnection,
  window: ReadWindow,
  rows: NormalizedBusyBlock[],
): Promise<void> {
  const t = schema.calendarBusyBlocks;
  await tx
    .delete(t)
    .where(and(eq(t.connectionId, conn.id), gt(t.endsAt, window.start)));
  if (rows.length === 0) return;
  const owner = { connectionId: conn.id, userId: conn.userId };
  await tx.insert(t).values(rows.map((r) => ({ ...r, ...owner })));
}

/**
 * The success UPDATE's SET. Never `status` (shared with the write side —
 * a success must not flip a `needs_reconnect` back). Pruned ids come from
 * the LOCKED row; a calendar the provider refused this run (policy 403)
 * leaves `provider_error` behind so the user can see something is failing.
 */
export function buildSyncedFields(
  locked: { readCalendarIds: string[] },
  result: Pick<FetchBusyResult, 'missingCalendarIds' | 'unreadableCalendarIds'>,
  stamp: { now: Date; random: () => number },
) {
  const missing = result.missingCalendarIds ?? [];
  const refused = result.unreadableCalendarIds ?? [];
  const pruned =
    missing.length > 0
      ? {
          readCalendarIds: pruneReadCalendarIds(
            locked.readCalendarIds,
            missing,
          ),
        }
      : {};
  return {
    lastErrorCode: refused.length > 0 ? ('provider_error' as const) : null,
    lastSyncedAt: stamp.now,
    nextSyncAt: nextReadSyncAt(stamp.now, stamp.random),
    updatedAt: stamp.now,
    ...pruned,
  };
}

async function markSynced(
  tx: ReadSyncTx,
  conn: ReadSyncConnection,
  fields: ReturnType<typeof buildSyncedFields>,
): Promise<void> {
  const c = schema.calendarConnections;
  await tx
    .update(c)
    .set(fields)
    .where(and(eq(c.id, conn.id), eq(c.status, 'active')));
}

async function windowFor(
  deps: ReadSyncDeps,
  conn: ReadSyncConnection,
  now: Date,
): Promise<ReadWindow> {
  const tz = await resolveUserTimezone(
    deps.db,
    conn.userId,
    deps.defaultTimezone,
  );
  return safeReadWindow(now, tz);
}

/** §4.4.2 steps 3–8 for one connection. Provider errors propagate. */
export async function runCalendarReadSync(
  deps: ReadSyncDeps,
  conn: ReadSyncConnection,
): Promise<ReadSyncOutcome> {
  const now = deps.now ? deps.now() : new Date();
  const window = await windowFor(deps, conn, now);
  const result = await fetchWindow(deps, conn, window);
  if (deps.stillAllowed && !(await deps.stillAllowed())) return 'skipped';
  const instanceId = deriveInstanceId(new URL(deps.clientUrl).host);
  const rows = result.unchanged
    ? null
    : normalizeBusyBlocks(result.blocks, { instanceId, window });
  const stamp = { now, random: deps.random ?? Math.random };
  const written = await deps.db.transaction(async (tx) => {
    const locked = await lockForSync(tx, conn, deps.afterBlocks !== undefined);
    if (!locked) return false;
    if (deps.stillAllowed && !(await deps.stillAllowed())) return false;
    if (rows) await replaceBlocks(tx, conn, window, rows);
    if (deps.afterBlocks) await deps.afterBlocks(tx, conn.userId);
    await markSynced(tx, conn, buildSyncedFields(locked, result, stamp));
    return true;
  });
  if (!written) return 'skipped';
  if (deps.onCommitted) await deps.onCommitted(conn.userId);
  return rows ? 'synced' : 'unchanged';
}

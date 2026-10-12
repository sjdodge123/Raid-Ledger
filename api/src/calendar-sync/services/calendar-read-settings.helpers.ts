/**
 * ROK-1593 §1.4 / §3.6: the read half of the user's Calendar Sync routes.
 *
 * - `PATCH /users/me/calendars/:id` `read` block (replaces 1596's 400
 *   `read_not_available`): `enabled: true` on a grant without the read scopes
 *   → 409 `read_scopes` (the web starts OAuth with `intent=read`); the
 *   dedicated (Raid Ledger) calendar is stripped from `calendarIds` (R1); a
 *   connection left reading gets a sync enqueued.
 * - `GET :id/calendars` — the read picker, dedicated calendar flagged
 *   `isRaidLedger` (the adapters leave that flag to the caller).
 * - `POST :id/sync` — manual sync, 429 `sync_throttled` within 5 min of the
 *   last one (D-R6, no new column) or while a failing row backs off.
 * - `PUT settings` — `user_preferences.calendar_read_mode` (D12). The busy
 *   query reads the mode at request time, so the cached hours are dropped.
 *   The `derive` job is PR-B: there is nothing to enqueue in PR-A.
 *
 * Error codes travel in the exception MESSAGE (the web reads `message`).
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CalendarSyncErrorCodeSchema,
  UpdateCalendarReadSettingsSchema,
  type ProviderCalendar,
  type UpdateCalendarConnection,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { CALENDAR_READ_MODE_KEY } from '../read/calendar-busy-query.helpers';
import {
  READ_SYNC_INTERVAL_MS,
  READ_SYNC_JITTER_MS,
} from '../read/calendar-read-sync.helpers';
import {
  enqueueCalendarDerive,
  enqueueCalendarReadSync,
  type CalendarReadEnqueueDeps,
} from '../read/calendar-read.enqueue.helpers';
import { enqueueDerivesBestEffort } from '../read/calendar-away-heal.helpers';
import type { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import { withFreshCredentials } from './calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ConnectionRow = typeof schema.calendarConnections.$inferSelect;
type ReadBody = NonNullable<UpdateCalendarConnection['read']>;

const logger = new Logger('CalendarReadSettings');

/** Manual sync: at most one per connection per 5 minutes (D-R6). */
export const MANUAL_SYNC_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Most source calendars one connection may read. Each one costs up to ten
 * provider pages per sync; the contract allows 200 ids, the server caps it.
 */
export const MAX_READ_CALENDAR_IDS = 25;

export interface CalendarReadSettingsDeps {
  db: Db;
  readQueue: CalendarReadEnqueueDeps;
  /** `GameTimeService.invalidateUserCache` — busy hours are cached. */
  invalidateUser: (userId: number) => void;
}

export interface OwnConnectionRef {
  userId: number;
  connectionId: number;
}

/** The caller's own row; anything else (incl. another user's id) → 404. */
export async function loadOwnCalendarConnection(
  db: Db | Tx,
  ref: OwnConnectionRef,
): Promise<ConnectionRow> {
  const t = schema.calendarConnections;
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.id, ref.connectionId), eq(t.userId, ref.userId)))
    .limit(1);
  if (!row || row.status === 'disconnecting') throw new NotFoundException();
  return row;
}

export interface ReadUpdatePlan {
  row: ConnectionRow;
  readEnabled: boolean;
  readCalendarIds: string[];
}

/** Validate a PATCH `read` block against the row. Persists nothing. */
export function planReadUpdate(
  row: ConnectionRow,
  read: ReadBody,
): ReadUpdatePlan {
  if (read.enabled === true && !row.readAccessGranted) {
    throw new ConflictException('read_scopes');
  }
  const ids = read.calendarIds ?? row.readCalendarIds;
  const dedicated = row.dedicatedCalendarId;
  const readCalendarIds = [...new Set(ids)].filter((id) => id !== dedicated);
  if (readCalendarIds.length > MAX_READ_CALENDAR_IDS) {
    throw new BadRequestException(
      `calendarIds: at most ${MAX_READ_CALENDAR_IDS} calendars can be read per connection`,
    );
  }
  return {
    row,
    readEnabled: read.enabled ?? row.readEnabled,
    readCalendarIds,
  };
}

/**
 * Persist a validated plan; a connection left reading gets a sync. Turning
 * read off queues a derive (review MAJOR-2): the connection's blocks stop
 * counting, so its synced away days must go too (Q12).
 */
export async function applyReadUpdate(
  deps: CalendarReadSettingsDeps,
  plan: ReadUpdatePlan,
): Promise<void> {
  const { row } = plan;
  await deps.db
    .update(schema.calendarConnections)
    .set({
      readEnabled: plan.readEnabled,
      readCalendarIds: plan.readCalendarIds,
      updatedAt: new Date(),
    })
    .where(eq(schema.calendarConnections.id, row.id));
  deps.invalidateUser(row.userId);
  if (plan.readEnabled) await enqueueCalendarReadSync(deps.readQueue, row.id);
  else if (row.readEnabled) {
    await enqueueDerivesBestEffort(
      deps.readQueue.queue,
      [row.userId],
      'read off',
    );
  }
}

/** `GET :id/calendars`: the picker rows, dedicated flagged `isRaidLedger`. */
export async function listConnectionCalendars(
  db: Db,
  registry: Pick<CalendarProviderRegistry, 'getReadProviderForConnection'>,
  ref: OwnConnectionRef,
): Promise<ProviderCalendar[]> {
  const row = await loadOwnCalendarConnection(db, ref);
  if (!row.readAccessGranted) throw new ConflictException('read_scopes');
  const provider = await registry.getReadProviderForConnection(row);
  if (!provider) throw new NotFoundException();
  const rows = await withFreshCredentials(db, row, provider, (creds) =>
    provider.listCalendars(creds),
  );
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    primary: c.primary,
    writable: c.writable,
    isRaidLedger: c.isRaidLedger || c.id === row.dedicatedCalendarId,
  }));
}

/**
 * Whether a manual sync is refused (429 `sync_throttled`) right now.
 *
 * - Healthy row: at most one per 5 min after the last SUCCESSFUL sync.
 * - `needs_reconnect`: always — no sync can succeed until the user
 *   reconnects, which resets the row.
 * - Failing row (a `last_error_code`) still inside its backoff
 *   (`next_sync_at > now`): refused until the backoff ends, so a broken
 *   grant is not hammered. A failing sync never moves `last_synced_at`, so
 *   the 5-min rule alone would never throttle it. Once the backoff has
 *   passed the user may try again; that attempt sets the next backoff.
 * - A partial success (a calendar refused by a policy 403) also leaves a
 *   `last_error_code`, but its `next_sync_at` is the regular cadence from
 *   the `last_synced_at` it just moved — not a backoff — so only the 5-min
 *   rule applies and a user who fixes their sharing can resync.
 */
export function isManualSyncThrottled(
  row: Pick<
    ConnectionRow,
    'status' | 'lastErrorCode' | 'nextSyncAt' | 'lastSyncedAt'
  >,
  nowMs: number,
): boolean {
  if (row.status === 'needs_reconnect') return true;
  const failing = row.lastErrorCode !== null && !scheduledBySuccess(row);
  const backoffUntil = row.nextSyncAt?.getTime();
  if (failing && backoffUntil !== undefined && backoffUntil > nowMs) {
    return true;
  }
  const last = row.lastSyncedAt?.getTime();
  return last !== undefined && nowMs - last < MANUAL_SYNC_THROTTLE_MS;
}

/**
 * `next_sync_at` was set by the success that moved `last_synced_at` (the
 * regular cadence). A failure never moves `last_synced_at` and backs off
 * at least 1 h from the failure, so its gap is always longer.
 */
function scheduledBySuccess(
  row: Pick<ConnectionRow, 'nextSyncAt' | 'lastSyncedAt'>,
): boolean {
  const last = row.lastSyncedAt?.getTime();
  const next = row.nextSyncAt?.getTime();
  if (last === undefined || next === undefined) return false;
  return next - last <= READ_SYNC_INTERVAL_MS + READ_SYNC_JITTER_MS;
}

/** `POST :id/sync`: 409 when not reading, 429 while throttled (above). */
export async function requestManualReadSync(
  deps: Pick<CalendarReadSettingsDeps, 'db' | 'readQueue'>,
  ref: OwnConnectionRef,
  nowMs: number = Date.now(),
): Promise<void> {
  const row = await loadOwnCalendarConnection(deps.db, ref);
  if (!row.readAccessGranted) throw new ConflictException('read_scopes');
  if (!row.readEnabled)
    throw new ConflictException(CalendarSyncErrorCodeSchema.enum.read_disabled);
  if (isManualSyncThrottled(row, nowMs)) {
    throw new HttpException('sync_throttled', HttpStatus.TOO_MANY_REQUESTS);
  }
  await enqueueCalendarReadSync(deps.readQueue, row.id);
}

/**
 * `PUT settings`: validate, upsert the read mode, drop cached hours, then
 * re-derive synced away days (mode `hours` derives none, `days`/`both` do).
 * The derive enqueue is best effort — the mode is already saved.
 */
export async function updateUserReadSettings(
  deps: Pick<CalendarReadSettingsDeps, 'db' | 'invalidateUser' | 'readQueue'>,
  userId: number,
  body: unknown,
): Promise<void> {
  const parsed = UpdateCalendarReadSettingsSchema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestException('invalid_body');
  const prefs = schema.userPreferences;
  await deps.db
    .insert(prefs)
    .values({ userId, key: CALENDAR_READ_MODE_KEY, value: parsed.data.mode })
    .onConflictDoUpdate({
      target: [prefs.userId, prefs.key],
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    });
  deps.invalidateUser(userId);
  await enqueueCalendarDerive(deps.readQueue.queue, userId).catch(
    (err: unknown) => {
      const name = err instanceof Error ? err.name : 'unknown';
      logger.warn(`derive enqueue after read-mode save failed (${name})`);
    },
  );
}

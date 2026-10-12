/**
 * Busy hours from synced calendars (ROK-1593 §3.5, epic ROK-669 §4.4 step 3).
 *
 * `calendar_busy_blocks` holds raw foreign busy instants. Two consumers read
 * them through this file:
 *
 * - the scheduling-poll heatmap (`fetchBusyKeys`) — blocks become a THIRD
 *   source of busy keys next to sign-ups and absences, unioned into the same
 *   per-user `Set` so an hour busy from both counts once (R5);
 * - the viewer's own composite week (`calendarBusy`, D15) — a SEPARATE field.
 *   It never changes a slot's status (§3.5 FLAG, slot semantics are open).
 *
 * Rules applied here, in the query layer:
 * - Only `status = 'active' AND read_enabled` connections count (Q12/D11): a
 *   `needs_reconnect`, `error` or `disconnecting` connection stops counting.
 * - Read mode (`user_preferences.calendar_read_mode`, default `both`, D12):
 *   `days` → no busy hours; `both` → timed blocks only (all-day blocks become
 *   away days in PR-B); `hours` → timed AND all-day blocks.
 * - R4 safety net: a block whose start AND end are each within ±60 s of an
 *   active sign-up's duration for the same user is our own copy — dropped.
 *
 * The admin kill switch is enforced twice: the purge on switch-off (D10)
 * empties the table, and `fetchCalendarBusyBlocks` itself returns nothing
 * while the switch is off (a sync racing the purge can never leak hours).
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CalendarProvider,
  GameTimeCalendarBusy,
} from '@raid-ledger/contract';
import { CalendarProviderSchema } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { readCalendarSyncEnabled } from './calendar-sync-enabled.query';
import { ACTIVE_SIGNUP_STATUSES } from '../../lineups/scheduling/active-signup-statuses.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** `user_preferences.key` for the per-user read mode (D12). */
export const CALENDAR_READ_MODE_KEY = 'calendar_read_mode';
export type CalendarReadMode = 'days' | 'hours' | 'both';
const DEFAULT_READ_MODE: CalendarReadMode = 'both';

/** R4 tolerance: a block this close to a sign-up's bounds is our own copy. */
export const SAFETY_NET_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One busy block that survived every filter. Instants only — no detail. */
export interface CalendarBusyBlock {
  userId: number;
  provider: CalendarProvider;
  startsAt: Date;
  endsAt: Date;
}

/** Whether a block of this kind counts as busy hours under `mode`. */
export function blockCountsForMode(
  allDay: boolean,
  mode: CalendarReadMode,
): boolean {
  if (mode === 'days') return false;
  return mode === 'hours' || !allDay;
}

/** R4: both bounds within ±60 s (inclusive) of one of the user's sign-ups. */
export function matchesSignupBounds(
  block: { startsAt: Date; endsAt: Date },
  signups: readonly [Date, Date][],
): boolean {
  return signups.some(
    ([start, end]) =>
      Math.abs(block.startsAt.getTime() - start.getTime()) <= SAFETY_NET_MS &&
      Math.abs(block.endsAt.getTime() - end.getTime()) <= SAFETY_NET_MS,
  );
}

function toReadMode(value: unknown): CalendarReadMode {
  return value === 'days' || value === 'hours' || value === 'both'
    ? value
    : DEFAULT_READ_MODE;
}

/** Blocks of active, read-enabled connections overlapping `[from, to)`. */
function queryBlocks(db: Db, userIds: number[], from: Date, to: Date) {
  const b = schema.calendarBusyBlocks;
  const c = schema.calendarConnections;
  return db
    .select({
      userId: b.userId,
      provider: c.provider,
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      allDay: b.allDay,
    })
    .from(b)
    .innerJoin(c, eq(b.connectionId, c.id))
    .where(
      and(
        inArray(b.userId, userIds),
        eq(c.status, 'active'),
        eq(c.readEnabled, true),
        lt(b.startsAt, to),
        gt(b.endsAt, from),
      ),
    );
}

async function queryReadModes(
  db: Db,
  userIds: number[],
): Promise<Map<number, CalendarReadMode>> {
  const p = schema.userPreferences;
  const rows = await db
    .select({ userId: p.userId, value: p.value })
    .from(p)
    .where(and(inArray(p.userId, userIds), eq(p.key, CALENDAR_READ_MODE_KEY)));
  return new Map(rows.map((r) => [r.userId, toReadMode(r.value)]));
}

/** Active sign-up durations near `[from, to)`, widened by the R4 tolerance. */
async function querySignupBounds(
  db: Db,
  userIds: number[],
  from: Date,
  to: Date,
): Promise<Map<number, [Date, Date][]>> {
  const s = schema.eventSignups;
  const e = schema.events;
  const lo = new Date(from.getTime() - SAFETY_NET_MS).toISOString();
  const hi = new Date(to.getTime() + SAFETY_NET_MS).toISOString();
  const rows = await db
    .select({ userId: s.userId, duration: e.duration })
    .from(s)
    .innerJoin(e, eq(s.eventId, e.id))
    .where(
      and(
        inArray(s.userId, userIds),
        inArray(s.status, [...ACTIVE_SIGNUP_STATUSES]),
        isNull(e.cancelledAt),
        sql`${e.duration} && ${`[${lo},${hi})`}::tsrange`,
      ),
    );
  const byUser = new Map<number, [Date, Date][]>();
  for (const row of rows) {
    if (row.userId == null) continue;
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.duration]);
  }
  return byUser;
}

/**
 * Calendar busy blocks for `userIds` overlapping `[from, to)`, after the
 * connection-status, read-mode and R4 filters. Empty input → no query.
 */
export async function fetchCalendarBusyBlocks(
  db: Db,
  userIds: number[],
  from: Date,
  to: Date,
): Promise<CalendarBusyBlock[]> {
  if (userIds.length === 0) return [];
  const rows = await queryBlocks(db, userIds, from, to);
  if (rows.length === 0) return [];
  if (!(await readCalendarSyncEnabled(db))) return [];
  const [modes, signups] = await Promise.all([
    queryReadModes(db, userIds),
    querySignupBounds(db, userIds, from, to),
  ]);
  const kept: CalendarBusyBlock[] = [];
  for (const row of rows) {
    const mode = modes.get(row.userId) ?? DEFAULT_READ_MODE;
    if (!blockCountsForMode(row.allDay, mode)) continue;
    if (matchesSignupBounds(row, signups.get(row.userId) ?? [])) continue;
    const provider = CalendarProviderSchema.safeParse(row.provider);
    if (!provider.success) continue;
    kept.push({ ...row, provider: provider.data });
  }
  return kept;
}

/**
 * Whole local hours a block occupies in the composite week, keyed
 * `${dayDiff}:${hour}` exactly like `addEventSlots` in
 * `users/game-time-composite.helpers.ts` (partial first hour skipped).
 */
function blockHourKeys(
  block: CalendarBusyBlock,
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
): Array<[number, number]> {
  const start = block.startsAt < weekStart ? weekStart : block.startsAt;
  const end = block.endsAt > weekEnd ? weekEnd : block.endsAt;
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < start) cursor.setUTCHours(cursor.getUTCHours() + 1);
  const shift = tzOffset * MINUTE_MS;
  const out: Array<[number, number]> = [];
  for (; cursor < end; cursor.setUTCHours(cursor.getUTCHours() + 1)) {
    const local = cursor.getTime() - shift;
    const day = Math.floor((local - (weekStart.getTime() - shift)) / DAY_MS);
    if (day >= 0 && day < 7) out.push([day, new Date(local).getUTCHours()]);
  }
  return out;
}

/** Collapse `provider|day` → hours into contiguous `[startHour, endHour)` runs. */
export function toBusyRanges(
  hours: Map<string, Set<number>>,
): GameTimeCalendarBusy[] {
  const ranges: GameTimeCalendarBusy[] = [];
  for (const [key, set] of hours) {
    const [providerRaw, dayRaw] = key.split('|');
    const provider = CalendarProviderSchema.safeParse(providerRaw);
    if (!provider.success) continue;
    const sorted = [...set].sort((a, b) => a - b);
    for (const hour of sorted) {
      const last = ranges[ranges.length - 1];
      const sameRun =
        last !== undefined &&
        last.provider === provider.data &&
        last.dayOfWeek === Number(dayRaw) &&
        last.endHour === hour;
      if (sameRun) last.endHour = hour + 1;
      else
        ranges.push({
          dayOfWeek: Number(dayRaw),
          startHour: hour,
          endHour: hour + 1,
          provider: provider.data,
        });
    }
  }
  return ranges.sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startHour - b.startHour,
  );
}

/**
 * The viewer's OWN calendar busy hours for the composite week (D15). Only
 * `userId`'s blocks are read, so another member's view never carries them.
 *
 * @param tzOffset - Viewer `getTimezoneOffset()` minutes; 0 = UTC.
 */
export async function fetchCalendarBusyHours(
  db: Db,
  userId: number,
  weekStart: Date,
  weekEnd: Date,
  tzOffset = 0,
): Promise<GameTimeCalendarBusy[]> {
  const blocks = await fetchCalendarBusyBlocks(
    db,
    [userId],
    weekStart,
    weekEnd,
  );
  const hours = new Map<string, Set<number>>();
  for (const block of blocks) {
    for (const [day, hour] of blockHourKeys(
      block,
      weekStart,
      weekEnd,
      tzOffset,
    )) {
      const key = `${block.provider}|${day}`;
      hours.set(key, (hours.get(key) ?? new Set<number>()).add(hour));
    }
  }
  return toBusyRanges(hours);
}

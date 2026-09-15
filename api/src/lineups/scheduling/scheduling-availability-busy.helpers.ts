/**
 * Dated busy-hour lookup for the scheduling-poll heatmap (ROK-1570).
 *
 * The aggregate heatmap is built from recurring game-time TEMPLATES only, so it
 * painted a member FREE at an hour they were already signed up for — the
 * viewer's personal week subtracts signups and absences, the group aggregate
 * never did. Templates are a recurring week and signups are dated, so the
 * subtraction is only meaningful against ONE concrete week: every helper here
 * takes that week's `[weekStart, weekEnd)` bounds.
 *
 * Keys are GRID convention (`0 = Sunday`, matching `AggregateGameTimeCell`),
 * never the template table's `0 = Monday`.
 *
 * ## Timezone contract (review fix)
 *
 * Templates and the grid are LOCAL wall clock — the web saves and positions
 * them with `getDay()` / `getHours()` — while `events.duration` is a true UTC
 * instant. Keying busy hours in UTC therefore landed the subtraction on the
 * wrong cell for every non-UTC viewer (a CT viewer's Tue 21:00 signup is
 * stored 02:00Z Wed and keyed `3:2` against a `2:21` template). So:
 *
 * - `tzOffset` is the browser's `Date.getTimezoneOffset()` in MINUTES
 *   (UTC - local; US Central ≈ 300). Absent → 0, i.e. UTC, the old behaviour.
 * - `weekStart` stays the CALENDAR Sunday 00:00 UTC the client sends and the
 *   response echoes. The LOCAL week's instant bounds are
 *   `[weekStart + tzOffset, weekStart + tzOffset + 7d)` — the signup SQL and
 *   the hour walk both use THOSE, so the local week keeps all 168 of its hours.
 * - Each hour instant is shifted `cursor - tzOffset` and keyed by the shifted
 *   value's `getUTCDay()` / `getUTCHours()` — the same arithmetic the personal
 *   view uses in `addEventSlots` (`users/game-time-composite.helpers.ts`).
 * - Absences are calendar DATES, not instants, so they stay on the calendar
 *   Sunday..Saturday and do not shift.
 *
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { SignupStatus } from '../../drizzle/schema/event-signups';
import { templateDayToGridDay } from '../../users/game-time-heatmap.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Cell = AggregateGameTimeResponse['cells'][number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

/**
 * Signup statuses that still occupy the member's evening. The complement —
 * `declined`, `roached_out`, `departed` — has released the slot, so those hours
 * are free again. One constant so the heatmap cannot drift from the roster.
 */
export const ACTIVE_SIGNUP_STATUSES: readonly SignupStatus[] = [
  'signed_up',
  'tentative',
];

/** `${gridDayOfWeek}:${localHour}` — the key both templates and busy rows share. */
export function busyKey(gridDayOfWeek: number, hour: number): string {
  return `${gridDayOfWeek}:${hour}`;
}

/** An event the member is actively signed up for, as its tsrange bounds. */
export interface BusySignupRow {
  userId: number | null;
  duration: [Date, Date];
}

/** A `date`-typed absence range (both bounds inclusive). */
export interface BusyAbsenceRow {
  userId: number;
  startDate: string;
  endDate: string;
}

/** The instant bounds of the viewer's LOCAL week (see the file header). */
function localWeekBounds(
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
): [Date, Date] {
  const shift = tzOffset * MINUTE_MS;
  return [
    new Date(weekStart.getTime() + shift),
    new Date(weekEnd.getTime() + shift),
  ];
}

/** `YYYY-MM-DD` for a UTC instant — the form the `date` columns compare on. */
function dateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Active signups whose event overlaps the viewer's local week.
 *
 * `cancelledAt IS NULL` (review fix): cancelling an event only stamps
 * `cancelled_at` — the signup rows keep `signed_up` — so without this a
 * cancelled raid painted the whole roster busy and the poll could never pick
 * that hour, the exact inverse of the bug this file fixes.
 */
function fetchSignups(
  db: Db,
  userIds: number[],
  localWeekStart: Date,
  localWeekEnd: Date,
): Promise<BusySignupRow[]> {
  const rangeStr = `[${localWeekStart.toISOString()},${localWeekEnd.toISOString()})`;
  return db
    .select({
      userId: schema.eventSignups.userId,
      duration: schema.events.duration,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.eventSignups.eventId, schema.events.id))
    .where(
      and(
        inArray(schema.eventSignups.userId, userIds),
        inArray(schema.eventSignups.status, [...ACTIVE_SIGNUP_STATUSES]),
        isNull(schema.events.cancelledAt),
        sql`${schema.events.duration} && ${rangeStr}::tsrange`,
      ),
    );
}

/** Absences whose inclusive range intersects the target week. */
function fetchAbsences(
  db: Db,
  userIds: number[],
  weekStart: Date,
  weekEnd: Date,
): Promise<BusyAbsenceRow[]> {
  return db
    .select({
      userId: schema.gameTimeAbsences.userId,
      startDate: schema.gameTimeAbsences.startDate,
      endDate: schema.gameTimeAbsences.endDate,
    })
    .from(schema.gameTimeAbsences)
    .where(
      and(
        inArray(schema.gameTimeAbsences.userId, userIds),
        lte(
          schema.gameTimeAbsences.startDate,
          dateString(weekEnd.getTime() - 1),
        ),
        gte(schema.gameTimeAbsences.endDate, dateString(weekStart.getTime())),
      ),
    );
}

/**
 * Expand an event's duration into the whole LOCAL hours it occupies inside the
 * viewer's week.
 *
 * Same semantics as `addEventSlots` (the personal view): the duration is
 * clamped to the local week, the cursor floors to the hour and SKIPS a partial
 * first hour, so 20:30-22:15 occupies 21 and 22 — a member who joins halfway
 * through 20:00 is still free to be scheduled at 20:00.
 *
 * @param duration - The event's `[start, end)` UTC instants.
 * @param weekStart - Calendar Sunday 00:00 UTC of the week being painted.
 * @param weekEnd - Calendar `weekStart + 7 days`.
 * @param tzOffset - Viewer `getTimezoneOffset()` minutes; 0 (default) = UTC.
 * @returns `${gridDay}:${localHour}` keys, in occurrence order.
 */
export function expandDurationToBusyKeys(
  duration: [Date, Date],
  weekStart: Date,
  weekEnd: Date,
  tzOffset = 0,
): string[] {
  const [localStart, localEnd] = localWeekBounds(weekStart, weekEnd, tzOffset);
  const start = new Date(duration[0]);
  const end = new Date(duration[1]);
  const clampedStart = start < localStart ? localStart : start;
  const clampedEnd = end > localEnd ? localEnd : end;
  const keys: string[] = [];
  const cursor = new Date(clampedStart);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < clampedStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
  while (cursor < clampedEnd) {
    const local = new Date(cursor.getTime() - tzOffset * MINUTE_MS);
    keys.push(busyKey(local.getUTCDay(), local.getUTCHours()));
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return keys;
}

/** Every hour of every calendar day the absence covers inside the week. */
export function expandAbsenceToBusyKeys(
  absence: BusyAbsenceRow,
  weekStart: Date,
  weekEnd: Date,
): string[] {
  const keys: string[] = [];
  for (let ms = weekStart.getTime(); ms < weekEnd.getTime(); ms += DAY_MS) {
    const day = dateString(ms);
    if (day < absence.startDate || day > absence.endDate) continue;
    const gridDay = new Date(ms).getUTCDay();
    for (let hour = 0; hour < 24; hour += 1) keys.push(busyKey(gridDay, hour));
  }
  return keys;
}

/** Add every key to the member's set, creating it on first use. */
function addKeys(
  busy: Map<number, Set<string>>,
  userId: number | null,
  keys: string[],
): void {
  if (userId == null || keys.length === 0) return;
  const set = busy.get(userId) ?? new Set<string>();
  for (const key of keys) set.add(key);
  busy.set(userId, set);
}

/** A template row as the aggregate stores it (day convention: 0 = Monday). */
export interface BusyTemplateRow {
  dayOfWeek: number;
  startHour: number;
}

/**
 * Re-add the cells every templated member is busy at, with `availableCount: 0`.
 *
 * `aggregateFreshnessCells` only emits cells that still hold a template row, so
 * once the busy subtraction empties one it disappeared from the response
 * entirely — the grid then had no `0 free` label for it, and an all-busy week
 * hid the heatmap section outright. The cell is real information ("everyone is
 * committed here"), not absence of data.
 *
 * @param cells - Cells aggregated from the POST-subtraction templates.
 * @param allTemplates - The FULL (pre-subtraction) template set.
 * @param unknownCount - Untemplated member count, as every other cell carries.
 * @param totalMembers - Shading denominator, as every other cell carries.
 * @returns `cells` plus one zeroed cell per template key it is missing.
 */
export function withFullyBusyCells(
  cells: Cell[],
  allTemplates: BusyTemplateRow[],
  unknownCount: number,
  totalMembers: number,
): Cell[] {
  const present = new Set(cells.map((c) => busyKey(c.dayOfWeek, c.hour)));
  const withBusy = [...cells];
  for (const template of allTemplates) {
    const dayOfWeek = templateDayToGridDay(template.dayOfWeek);
    const key = busyKey(dayOfWeek, template.startHour);
    if (present.has(key)) continue;
    present.add(key);
    withBusy.push({
      dayOfWeek,
      hour: template.startHour,
      availableCount: 0,
      staleCount: 0,
      unknownCount,
      totalCount: totalMembers,
    });
  }
  return withBusy;
}

/**
 * Hours the given members are already committed during the viewer's local week.
 *
 * @param db - Drizzle handle.
 * @param userIds - Roster to look up. Empty short-circuits without querying.
 * @param weekStart - Calendar Sunday 00:00 UTC of the week the grid describes.
 * @param weekEnd - Exclusive calendar end of that week (weekStart + 7 days).
 * @param tzOffset - Viewer `getTimezoneOffset()` minutes; 0 (default) = UTC.
 * @returns userId -> set of `${gridDayOfWeek}:${localHour}` keys. A member with
 *   nothing on that week is absent from the map entirely.
 */
export async function fetchBusyKeys(
  db: Db,
  userIds: number[],
  weekStart: Date,
  weekEnd: Date,
  tzOffset = 0,
): Promise<Map<number, Set<string>>> {
  const busy = new Map<number, Set<string>>();
  if (userIds.length === 0) return busy;
  const [localStart, localEnd] = localWeekBounds(weekStart, weekEnd, tzOffset);
  const [signups, absences] = await Promise.all([
    fetchSignups(db, userIds, localStart, localEnd),
    fetchAbsences(db, userIds, weekStart, weekEnd),
  ]);
  for (const row of signups) {
    addKeys(
      busy,
      row.userId,
      expandDurationToBusyKeys(row.duration, weekStart, weekEnd, tzOffset),
    );
  }
  for (const row of absences) {
    addKeys(busy, row.userId, expandAbsenceToBusyKeys(row, weekStart, weekEnd));
  }
  return busy;
}

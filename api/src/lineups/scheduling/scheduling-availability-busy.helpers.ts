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
 * Read-only: no INSERT/UPDATE/DELETE anywhere in this file.
 */
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { SignupStatus } from '../../drizzle/schema/event-signups';

type Db = PostgresJsDatabase<typeof schema>;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Signup statuses that still occupy the member's evening. The complement —
 * `declined`, `roached_out`, `departed` — has released the slot, so those hours
 * are free again. One constant so the heatmap cannot drift from the roster.
 */
export const ACTIVE_SIGNUP_STATUSES: readonly SignupStatus[] = [
  'signed_up',
  'tentative',
];

/** `${gridDayOfWeek}:${utcHour}` — the key both templates and busy rows share. */
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

/** `YYYY-MM-DD` for a UTC instant — the form the `date` columns compare on. */
function dateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Active signups whose event overlaps the target week, for the whole roster. */
function fetchSignups(
  db: Db,
  userIds: number[],
  weekStart: Date,
  weekEnd: Date,
): Promise<BusySignupRow[]> {
  const rangeStr = `[${weekStart.toISOString()},${weekEnd.toISOString()})`;
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
        sql`${schema.events.duration} && ${rangeStr}::tsrange`,
      ),
    ) as unknown as Promise<BusySignupRow[]>;
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
        lte(schema.gameTimeAbsences.startDate, dateString(weekEnd.getTime() - 1)),
        gte(schema.gameTimeAbsences.endDate, dateString(weekStart.getTime())),
      ),
    );
}

/**
 * Expand an event's duration into the whole hours it occupies inside the week.
 *
 * Same semantics as `buildCommittedDbKeys` (the personal view): the cursor
 * floors to the hour and SKIPS a partial first hour, so 20:30-22:15 occupies
 * 21 and 22 — a member who joins halfway through 20:00 is still free to be
 * scheduled at 20:00. Hours outside `[weekStart, weekEnd)` are dropped: the
 * grid is one dated week, and a neighbouring week's event is not on it.
 */
export function expandDurationToBusyKeys(
  duration: [Date, Date],
  weekStart: Date,
  weekEnd: Date,
): string[] {
  const [start, end] = [new Date(duration[0]), new Date(duration[1])];
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < start) cursor.setUTCHours(cursor.getUTCHours() + 1);
  while (cursor < end) {
    if (cursor >= weekStart && cursor < weekEnd) {
      keys.push(busyKey(cursor.getUTCDay(), cursor.getUTCHours()));
    }
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
  return keys;
}

/** Every hour of every day the absence covers inside the week. */
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

/**
 * Hours the given members are already committed during `[weekStart, weekEnd)`.
 *
 * @param db - Drizzle handle.
 * @param userIds - Roster to look up. Empty short-circuits without querying.
 * @param weekStart - Sunday 00:00 UTC of the week the grid describes.
 * @param weekEnd - Exclusive end of that week (weekStart + 7 days).
 * @returns userId -> set of `${gridDayOfWeek}:${utcHour}` keys. A member with
 *   nothing on that week is absent from the map entirely.
 */
export async function fetchBusyKeys(
  db: Db,
  userIds: number[],
  weekStart: Date,
  weekEnd: Date,
): Promise<Map<number, Set<string>>> {
  const busy = new Map<number, Set<string>>();
  if (userIds.length === 0) return busy;
  const [signups, absences] = await Promise.all([
    fetchSignups(db, userIds, weekStart, weekEnd),
    fetchAbsences(db, userIds, weekStart, weekEnd),
  ]);
  for (const row of signups) {
    addKeys(busy, row.userId, expandDurationToBusyKeys(row.duration, weekStart, weekEnd));
  }
  for (const row of absences) {
    addKeys(busy, row.userId, expandAbsenceToBusyKeys(row, weekStart, weekEnd));
  }
  return busy;
}

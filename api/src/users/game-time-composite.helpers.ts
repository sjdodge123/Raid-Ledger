/**
 * Composite view helpers for GameTimeService.
 * Extracted from game-time.service.ts for file size compliance (ROK-711).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  CompositeSlot,
  SignedUpEventRow,
  CompositeViewResult,
  OverrideRecord,
  AbsenceRecord,
} from './game-time.types';

// Re-export for backward compatibility
export { fetchSignupsPreview } from './game-time-signups.helpers';
export type { SignupsPreviewMap } from './game-time-signups.helpers';
export { buildEventBlocks } from './game-time-blocks.helpers';
import type { SignupsPreviewMap } from './game-time-signups.helpers';
import { buildEventBlocks } from './game-time-blocks.helpers';

/** Select columns for signed-up event queries. */
const SIGNED_UP_EVENT_COLUMNS = {
  eventId: schema.events.id,
  title: schema.events.title,
  description: schema.events.description,
  duration: schema.events.duration,
  signupId: schema.eventSignups.id,
  confirmationStatus: schema.eventSignups.confirmationStatus,
  gameId: schema.games.id,
  gameSlug: schema.games.slug,
  gameName: schema.games.name,
  gameCoverUrl: schema.games.coverUrl,
  creatorId: schema.events.creatorId,
  creatorUsername: schema.users.username,
} as const;

/** Fetch signed-up events for a specific week with game/creator data. */
export async function fetchWeekSignedUpEvents(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  weekStart: Date,
  weekEnd: Date,
): Promise<SignedUpEventRow[]> {
  const weekRange = `[${weekStart.toISOString()},${weekEnd.toISOString()})`;
  return db
    .select(SIGNED_UP_EVENT_COLUMNS)
    .from(schema.eventSignups)
    .innerJoin(schema.events, eq(schema.eventSignups.eventId, schema.events.id))
    .leftJoin(schema.users, eq(schema.events.creatorId, schema.users.id))
    .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
    .where(
      and(
        eq(schema.eventSignups.userId, userId),
        sql`${schema.events.duration} && ${weekRange}::tsrange`,
      ),
    );
}

/** Check if error is a missing table error (42P01). */
function isMissingTableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: string }).code === '42P01'
  );
}

/** Fetch overrides for a week range. */
export async function fetchOverrides(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  weekStartDate: string,
  weekEndDate: string,
): Promise<OverrideRecord[]> {
  try {
    return await db
      .select({
        date: schema.gameTimeOverrides.date,
        hour: schema.gameTimeOverrides.hour,
        status: schema.gameTimeOverrides.status,
      })
      .from(schema.gameTimeOverrides)
      .where(
        and(
          eq(schema.gameTimeOverrides.userId, userId),
          gte(schema.gameTimeOverrides.date, weekStartDate),
          lte(schema.gameTimeOverrides.date, weekEndDate),
        ),
      );
  } catch (err: unknown) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Fetch absences overlapping a week range. */
export async function fetchAbsences(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  weekStartDate: string,
  weekEndDate: string,
): Promise<AbsenceRecord[]> {
  try {
    return await db
      .select({
        id: schema.gameTimeAbsences.id,
        startDate: schema.gameTimeAbsences.startDate,
        endDate: schema.gameTimeAbsences.endDate,
        reason: schema.gameTimeAbsences.reason,
      })
      .from(schema.gameTimeAbsences)
      .where(
        and(
          eq(schema.gameTimeAbsences.userId, userId),
          lte(schema.gameTimeAbsences.startDate, weekEndDate),
          gte(schema.gameTimeAbsences.endDate, weekStartDate),
        ),
      );
  } catch (err: unknown) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

/** Build committed slot set from event durations. */
export function buildCommittedSet(
  events: Array<{ duration: [Date, Date] }>,
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
): Set<string> {
  const committedSet = new Set<string>();
  for (const event of events) {
    addEventSlots(committedSet, event.duration, weekStart, weekEnd, tzOffset);
  }
  return committedSet;
}

function addEventSlots(
  set: Set<string>,
  duration: [Date, Date],
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
): void {
  const clampedStart = duration[0] < weekStart ? weekStart : duration[0];
  const clampedEnd = duration[1] > weekEnd ? weekEnd : duration[1];
  const cursor = new Date(clampedStart);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor < clampedStart) cursor.setUTCHours(cursor.getUTCHours() + 1);
  while (cursor < clampedEnd) {
    const localMs = cursor.getTime() - tzOffset * 60 * 1000;
    const localDate = new Date(localMs);
    const weekStartLocalMs = weekStart.getTime() - tzOffset * 60 * 1000;
    const dayDiff = Math.floor(
      (localMs - weekStartLocalMs) / (1000 * 60 * 60 * 24),
    );
    if (dayDiff >= 0 && dayDiff < 7)
      set.add(`${dayDiff}:${localDate.getUTCHours()}`);
    cursor.setUTCHours(cursor.getUTCHours() + 1);
  }
}

/** Determine status for a single template slot. */
function resolveSlotStatus(
  dateStr: string,
  hour: number,
  key: string,
  absenceDates: Set<string>,
  overrideMap: Map<string, string>,
  committedSet: Set<string>,
): CompositeSlot['status'] {
  if (absenceDates.has(dateStr)) return 'blocked';
  const overrideStatus = overrideMap.get(`${dateStr}:${hour}`);
  if (overrideStatus) return overrideStatus as CompositeSlot['status'];
  return committedSet.has(key) ? 'committed' : 'available';
}

/** Build composite slots from template. */
export function buildCompositeSlots(
  templateSlots: Array<{ dayOfWeek: number; hour: number }>,
  templateSet: Set<string>,
  committedSet: Set<string>,
  absenceDates: Set<string>,
  overrideMap: Map<string, string>,
  weekStart: Date,
): CompositeSlot[] {
  const slots = templateSlots.map((s) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(dayDate.getDate() + s.dayOfWeek);
    const dateStr = dayDate.toISOString().split('T')[0];
    const status = resolveSlotStatus(dateStr, s.hour, `${s.dayOfWeek}:${s.hour}`, absenceDates, overrideMap, committedSet);
    return { dayOfWeek: s.dayOfWeek, hour: s.hour, status, fromTemplate: true };
  });
  for (const key of committedSet) {
    if (!templateSet.has(key)) {
      const [day, hour] = key.split(':').map(Number);
      slots.push({ dayOfWeek: day, hour, status: 'committed', fromTemplate: false });
    }
  }
  return slots;
}

/** Build absence date set for quick lookup. */
export function buildAbsenceDateSet(
  absences: Array<{ startDate: string; endDate: string }>,
): Set<string> {
  const absenceDates = new Set<string>();
  for (const absence of absences) {
    const start = new Date(absence.startDate);
    const end = new Date(absence.endDate);
    const cursor = new Date(start);
    while (cursor <= end) {
      absenceDates.add(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return absenceDates;
}

/** Assemble the full composite view result from all fetched data. */
export function assembleCompositeView(
  remapped: Array<{ dayOfWeek: number; hour: number }>,
  signedUpEvents: SignedUpEventRow[],
  overrideRows: OverrideRecord[],
  absenceRows: AbsenceRecord[],
  signupsMap: SignupsPreviewMap,
  weekStart: Date,
  weekEnd: Date,
  tzOffset: number,
): CompositeViewResult {
  const templateSet = new Set(remapped.map((s) => `${s.dayOfWeek}:${s.hour}`));
  const committedSet = buildCommittedSet(signedUpEvents, weekStart, weekEnd, tzOffset);
  const absenceDates = buildAbsenceDateSet(absenceRows);
  const overrideMap = new Map<string, string>();
  for (const o of overrideRows) overrideMap.set(`${o.date}:${o.hour}`, o.status);
  const slots = buildCompositeSlots(remapped, templateSet, committedSet, absenceDates, overrideMap, weekStart);
  const events = buildEventBlocks(signedUpEvents, weekStart, weekEnd, tzOffset, signupsMap);
  return { slots, events, weekStart: weekStart.toISOString(), overrides: overrideRows, absences: absenceRows };
}

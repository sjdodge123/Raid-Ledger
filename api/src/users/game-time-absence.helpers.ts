/**
 * Absence-list helpers for GameTimeService (ROK-1427).
 *
 * The absence LIST endpoint surfaces only current + future absences. Past
 * absences are NOT deleted — they stay in the DB as history, and the
 * week-bounded composite view (`fetchAbsences` in game-time-composite.helpers)
 * still needs them to render past weeks correctly.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, gte } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { AbsenceRecord } from './game-time.types';

/**
 * Resolve "today" as a YYYY-MM-DD string in the caller's local timezone.
 *
 * `tzOffset` follows the browser `Date.getTimezoneOffset()` convention already
 * used across the game-time module (see game-time-blocks.helpers): minutes to
 * ADD to local time to reach UTC, so local = UTC - offset. New York in EST is
 * 300; Auckland in NZST is -720.
 */
export function resolveLocalToday(
  tzOffset = 0,
  now: Date = new Date(),
): string {
  const localMs = now.getTime() - tzOffset * 60 * 1000;
  return new Date(localMs).toISOString().split('T')[0];
}

/**
 * Fetch a user's absences whose end date has not passed yet.
 *
 * `end_date` is INCLUSIVE: an absence ending on `fromDate` is still active on
 * that date and IS returned; one that ended the day before is not.
 */
export async function fetchAbsencesEndingOnOrAfter(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
  fromDate: string,
): Promise<AbsenceRecord[]> {
  return db
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
        gte(schema.gameTimeAbsences.endDate, fromDate),
      ),
    );
}

/**
 * ROK-1593 PR-B: deleting vs ignoring an absence.
 *
 * A `manual` absence is the user's own and is deleted. A `calendar` absence
 * is derived by sync, so deleting it would only bring it back on the next
 * derive — it is dismissed with Ignore instead: the row is deleted and every
 * date of its range lands in `calendar_ignored_days`, which the derive
 * subtracts (epic ROK-669 §4: Ignore = deletion + ignored-day entries, never
 * an `ignored_at` flag).
 *
 * Error codes ride on the exception message, like the calendar routes'
 * `read_disabled` (the API answers `{ statusCode: 409, message: '<code>' }`).
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { expandDateRange } from '../calendar-sync/read/calendar-away-derive.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const ABSENCE_ERROR_CODES = {
  /** DELETE on a synced (`calendar`) absence — use Ignore. */
  useIgnore: 'use_ignore',
  /** Ignore on a `manual` absence — delete it instead. */
  notCalendar: 'not_calendar',
} as const;

const a = schema.gameTimeAbsences;

/**
 * Delete one of the user's manual absences. A calendar row → 409
 * `use_ignore`; a missing or foreign id stays a silent no-op (the pre-1593
 * behaviour of `DELETE /absences/:id`).
 */
export async function deleteManualAbsence(
  db: Db,
  userId: number,
  absenceId: number,
): Promise<void> {
  const owned = and(eq(a.id, absenceId), eq(a.userId, userId));
  const deleted = await db
    .delete(a)
    .where(and(owned, eq(a.source, 'manual')))
    .returning({ id: a.id });
  if (deleted.length > 0) return;
  const [synced] = await db
    .select({ id: a.id })
    .from(a)
    .where(and(owned, eq(a.source, 'calendar')))
    .limit(1);
  if (synced) throw new ConflictException(ABSENCE_ERROR_CODES.useIgnore);
}

/**
 * Ignore one of the user's calendar absences, in one transaction: delete the
 * row and record each date of its range as ignored (idempotent per date).
 * Missing / another user's id → 404; a manual row → 409 `not_calendar`.
 */
export async function ignoreCalendarAbsence(
  db: Db,
  userId: number,
  absenceId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ source: a.source, startDate: a.startDate, endDate: a.endDate })
      .from(a)
      .where(and(eq(a.id, absenceId), eq(a.userId, userId)))
      .limit(1)
      .for('update');
    if (!row) throw new NotFoundException('Absence not found');
    if (row.source !== 'calendar') {
      throw new ConflictException(ABSENCE_ERROR_CODES.notCalendar);
    }
    await tx.delete(a).where(eq(a.id, absenceId));
    const dates = expandDateRange(row.startDate, row.endDate);
    if (dates.length === 0) return;
    await tx
      .insert(schema.calendarIgnoredDays)
      .values(dates.map((date) => ({ userId, date })))
      .onConflictDoNothing();
  });
}

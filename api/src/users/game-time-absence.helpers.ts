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
import { isMissingTableError } from '../common/pg-error.helpers';
import { defined } from '../common/defined.helpers';
import {
  CalendarProviderSchema,
  GameTimeAbsenceSourceSchema,
} from '@raid-ledger/contract';

type Db = PostgresJsDatabase<typeof schema>;

/** A raw absence row with its source and (left-joined) provider (ROK-1593). */
interface AbsenceRow {
  id: number;
  startDate: string;
  endDate: string;
  reason: string | null;
  source: string;
  provider: string | null;
}

/**
 * Select absences with `source` and the provider of the connection a
 * `calendar` row came from (left join: manual rows have no connection).
 * Every absence read model goes through this so list and composite agree.
 */
export function selectAbsencesWithSource(db: Db) {
  const a = schema.gameTimeAbsences;
  const c = schema.calendarConnections;
  return db
    .select({
      id: a.id,
      startDate: a.startDate,
      endDate: a.endDate,
      reason: a.reason,
      source: a.source,
      provider: c.provider,
    })
    .from(a)
    .leftJoin(c, eq(c.id, a.calendarConnectionId));
}

/** Narrow the varchar columns to the contract enums (unknown → omitted). */
export function toAbsenceRecord(row: AbsenceRow): AbsenceRecord {
  const source = GameTimeAbsenceSourceSchema.safeParse(row.source);
  const provider = CalendarProviderSchema.safeParse(row.provider);
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    reason: row.reason,
    ...(source.success ? { source: source.data } : {}),
    ...(provider.success ? { provider: provider.data } : {}),
  };
}

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
  return defined(
    new Date(localMs).toISOString().split('T')[0],
    'ISO date part',
  );
}

/**
 * Fetch a user's absences whose end date has not passed yet.
 *
 * `end_date` is INCLUSIVE: an absence ending on `fromDate` is still active on
 * that date and IS returned; one that ended the day before is not.
 *
 * Returns `[]` when the `game_time_absences` table does not exist (42P01),
 * matching the week-bounded `fetchAbsences`; any other error propagates.
 */
export async function fetchAbsencesEndingOnOrAfter(
  db: Db,
  userId: number,
  fromDate: string,
): Promise<AbsenceRecord[]> {
  try {
    const rows = await selectAbsencesWithSource(db).where(
      and(
        eq(schema.gameTimeAbsences.userId, userId),
        gte(schema.gameTimeAbsences.endDate, fromDate),
      ),
    );
    return rows.map(toAbsenceRecord);
  } catch (err: unknown) {
    if (isMissingTableError(err)) return [];
    throw err;
  }
}

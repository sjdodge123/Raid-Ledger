import type { AttendanceStatus } from '@raid-ledger/contract';
import type {
  GgEventsCard,
  GgOnTimeCardSchema,
  GgRhythmCardSchema,
} from '@raid-ledger/contract';
import type { z } from 'zod';
import type * as schema from '../../../../drizzle/schema';
import { resolveAttendanceStatus } from '../../../../events/attendance.helpers';
import { ACTIVE_SIGNUP_STATUSES } from '../../../../events/series-signups-plan.helpers';

type SignupRow = typeof schema.eventSignups.$inferSelect;
export type GgOnTimeCard = z.infer<typeof GgOnTimeCardSchema>;
export type GgRhythmCard = z.infer<typeof GgRhythmCardSchema>;

/**
 * One of the user's signups on a non-cancelled event that started inside the
 * GG window, with the event start and its community-tz month/weekday/hour.
 */
export interface GgSignupRow {
  signup: SignupRow;
  /** Event start (`lower(duration)`) as epoch milliseconds. */
  startMs: number;
  /** 1–12 in the community tz. */
  month: number;
  /** 0 = Sunday … 6 = Saturday in the community tz. */
  weekday: number;
  /** 0–23 in the community tz. */
  hour: number;
  /** The user's voice session on that event was classified `late`. */
  voiceLate: boolean;
}

/** The row's attendance through the app's own resolver (attendance.helpers). */
export function attendanceOf(row: GgSignupRow): AttendanceStatus | null {
  return resolveAttendanceStatus(row.signup, new Date(row.startMs));
}

/**
 * A signup "counts" as signed up when it is live (`ACTIVE_SIGNUP_STATUSES`)
 * or resolved to attended / no-show (departed, late roach-outs).
 */
export function isCountedSignup(row: GgSignupRow): boolean {
  const status = attendanceOf(row);
  if (status === 'attended' || status === 'no_show') return true;
  return ACTIVE_SIGNUP_STATUSES.some((s) => s === row.signup.status);
}

/** Most frequent value; ties go to the smallest value. `null` when empty. */
export function modeOf(
  values: readonly number[],
): { value: number; count: number } | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: number; count: number } | null = null;
  for (const [value, count] of counts) {
    const better =
      best === null ||
      count > best.count ||
      (count === best.count && value < best.value);
    if (better) best = { value, count };
  }
  return best;
}

function countStatus(rows: GgSignupRow[], status: AttendanceStatus): number {
  return rows.filter((r) => attendanceOf(r) === status).length;
}

/** Card 2 (metrics 1, 2, 4); `null` when nothing was signed up or created. */
export function summarizeEvents(
  rows: GgSignupRow[],
  created: number,
): GgEventsCard | null {
  const counted = rows.filter(isCountedSignup);
  if (counted.length === 0 && created === 0) return null;
  const starts = counted.map((r) => r.startMs);
  const iso = (ms: number): string => new Date(ms).toISOString();
  return {
    signedUp: counted.length,
    attended: countStatus(rows, 'attended'),
    noShows: countStatus(rows, 'no_show'),
    excused: countStatus(rows, 'excused'),
    created,
    firstEventAt: starts.length > 0 ? iso(Math.min(...starts)) : null,
    lastEventAt: starts.length > 0 ? iso(Math.max(...starts)) : null,
  };
}

/** Attended with no late-minutes, running-late or voice `late` marker. */
export function isOnTime(row: GgSignupRow): boolean {
  if (attendanceOf(row) !== 'attended') return false;
  const s = row.signup;
  return s.lateMinutes === null && s.runningLateAt === null && !row.voiceLate;
}

/** Card 3 (metric 3); `null` when the user attended nothing. */
export function summarizeOnTime(rows: GgSignupRow[]): GgOnTimeCard | null {
  const attended = countStatus(rows, 'attended');
  if (attended === 0) return null;
  const onTime = rows.filter(isOnTime).length;
  return { attended, onTime, onTimeRatio: onTime / attended };
}

/** Card 4 (metric 2) over counted signups; `null` when there are none. */
export function summarizeRhythm(rows: GgSignupRow[]): GgRhythmCard | null {
  const counted = rows.filter(isCountedSignup);
  const month = modeOf(counted.map((r) => r.month));
  const weekday = modeOf(counted.map((r) => r.weekday));
  const hour = modeOf(counted.map((r) => r.hour));
  if (month === null || weekday === null || hour === null) return null;
  return {
    busiestMonth: month.value,
    busiestMonthEvents: month.count,
    favouriteWeekday: weekday.value,
    favouriteHour: hour.value,
  };
}

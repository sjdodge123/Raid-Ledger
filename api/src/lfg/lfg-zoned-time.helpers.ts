/**
 * Wall-clock ⇄ instant arithmetic for the LFG overlap read (ROK-1463 §A, C1).
 *
 * The game-time grid stores each member's own LOCAL wall clock:
 * `game_time_templates.start_hour` / `game_time_overrides.hour` are hours in
 * the timezone the member picked (`user_preferences.key = 'timezone'`, falling
 * back to `app_settings.default_timezone`), and `game_time_overrides.date` /
 * `game_time_absences.start_date` are that member's local calendar days. The
 * overlap read intersects members against each other, so every one of those
 * local values has to become a concrete UTC instant FIRST — otherwise a New
 * Yorker's 20:00 and a Berliner's 20:00 look like the same hour when in truth
 * they are five hours apart.
 *
 * Everything here is pure and derives its offsets from `Intl.DateTimeFormat`,
 * so it is correct across DST without a timezone database dependency. The
 * approach mirrors `discord-bot/utils/embed-lead-time.ts::localDateTimeToUtc`,
 * whose helpers are private to that module.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** One local calendar day of a member's grid. */
export interface ZonedDay {
  /** `YYYY-MM-DD` in the member's zone — what the `date` columns store. */
  dateStr: string;
  /** 0 = Monday (the `game_time_templates` convention). */
  dayOfWeek: number;
}

/** Numeric wall-clock components of an instant in one zone. */
interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Read an instant's wall clock in `timeZone`, never the runner's own zone. */
function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // `hour12: false` renders midnight as `24` in some ICU versions.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds.
 * Positive east of UTC (`Europe/Berlin` in summer = +2h).
 */
function offsetMsAt(instant: Date, timeZone: string): number {
  const local = wallClockIn(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The `YYYY-MM-DD` calendar day an instant falls on in `timeZone`.
 *
 * @param instant - The UTC instant.
 * @param timeZone - IANA zone.
 */
export function zonedDayKey(instant: Date, timeZone: string): string {
  const { year, month, day } = wallClockIn(instant, timeZone);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `dateStr` at
 * `hour:00`.
 *
 * Two passes: guess with the offset at the naive instant, then re-check the
 * offset at the adjusted one so a DST boundary inside the guess is corrected.
 * A wall-clock hour that does not exist (the spring-forward gap) still yields
 * a well-defined instant rather than throwing — the grid is advisory, and a
 * member's missing hour is not worth a 500.
 *
 * @param dateStr - `YYYY-MM-DD` in the member's zone.
 * @param hour - Local hour, 0–23.
 * @param timeZone - IANA zone.
 */
export function zonedHourToUtc(
  dateStr: string,
  hour: number,
  timeZone: string,
): Date {
  const naive = Date.parse(`${dateStr}T00:00:00Z`) + hour * HOUR_MS;
  const guessOffset = offsetMsAt(new Date(naive), timeZone);
  const adjusted = naive - guessOffset;
  const trueOffset = offsetMsAt(new Date(adjusted), timeZone);
  return new Date(trueOffset === guessOffset ? adjusted : naive - trueOffset);
}

/** The calendar day after `dateStr`, as `YYYY-MM-DD`. */
export function nextCalendarDay(dateStr: string): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * Day index in the grid's own convention: 0 = Monday, 6 = Sunday
 * (`game-time-templates.ts:26`, which disagrees with `events.schema.ts:306`).
 *
 * @param dateStr - `YYYY-MM-DD`. A calendar day has one weekday in every zone,
 *   so no zone argument is needed.
 */
export function gridDayOfWeek(dateStr: string): number {
  return (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Every local calendar day `[from, to)` touches in `timeZone`, oldest first.
 *
 * The bounds are instants, so the day list differs per member: a horizon that
 * starts at 02:00 UTC has already started "yesterday" in New York.
 *
 * @param from - Horizon start instant (inclusive).
 * @param to - Horizon end instant (exclusive).
 * @param timeZone - IANA zone.
 */
export function enumerateZonedDays(
  from: Date,
  to: Date,
  timeZone: string,
): ZonedDay[] {
  const last = zonedDayKey(new Date(to.getTime() - 1), timeZone);
  const days: ZonedDay[] = [];
  let cursor = zonedDayKey(from, timeZone);
  while (cursor <= last) {
    days.push({ dateStr: cursor, dayOfWeek: gridDayOfWeek(cursor) });
    cursor = nextCalendarDay(cursor);
  }
  return days;
}

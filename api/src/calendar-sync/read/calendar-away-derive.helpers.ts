/**
 * ROK-1593 PR-B (epic ROK-669 §4.6) — whole-day "away" derivation. PURE: no
 * DB, no clock. `calendar-away-persist.helpers.ts` (B3) loads the inputs and
 * diff-upserts the returned ranges as `source = 'calendar'` absences.
 *
 * For each local date D in the window (user's IANA zone, DST-correct via the
 * `lfg-zoned-time` Intl helpers — never fixed offsets):
 * - **Rule A (all-day):** an all-day block with `firstDate ≤ D ≤ lastDate`
 *   makes D away. All-day dates are taken as the provider states them — they
 *   are never shifted through the user's zone.
 * - **Rule B (fully booked game time):** the template hours for weekday(D)
 *   (`0 = Monday`, `game-time-templates.ts`) become local hour intervals
 *   `[D h:00, D h+1:00)` as instants. If that set is non-empty AND every
 *   interval is fully covered by the union of the timed blocks (from ANY
 *   connection — Q16 combines them) → D is away. No template → never fires.
 * - Ignored dates and dates inside a manual absence (Q-D) are removed.
 * - Consecutive dates merge into inclusive ranges, each attributed to the
 *   lowest connection id that contributed to any of its dates.
 *
 * Mode `hours` → no away days; `days` and `both` derive identically (D12).
 */
import type { CalendarReadMode } from './calendar-busy-query.helpers';
import {
  enumerateZonedDays,
  nextCalendarDay,
  zonedHourToUtc,
  type ZonedDay,
} from '../../lfg/lfg-zoned-time.helpers';

const HOUR_MS = 60 * 60 * 1000;

/** One `calendar_busy_blocks` row as the derivation needs it. */
export interface AwayDeriveBlock {
  connectionId: number;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** Inclusive provider-stated dates (`YYYY-MM-DD`), set iff `allDay`. */
  firstDate: string | null;
  lastDate: string | null;
}

/** One `game_time_templates` row: `dayOfWeek` 0 = Monday … 6 = Sunday. */
export interface AwayTemplateHour {
  dayOfWeek: number;
  startHour: number;
}

export interface AwayDeriveInput {
  /** The user's blocks across ALL active, read-enabled connections. */
  blocks: readonly AwayDeriveBlock[];
  mode: CalendarReadMode;
  templateHours: readonly AwayTemplateHour[];
  /** User IANA zone. */
  timeZone: string;
  /** `[start, end)` instants; every local day it touches is considered. */
  window: { start: Date; end: Date };
  /** `calendar_ignored_days.date` values (`YYYY-MM-DD`). */
  ignoredDates: readonly string[];
  /** Every date inside a manual absence (`expandDateRange` per row). */
  manualDates: readonly string[];
}

/**
 * One synced away range. Field names match `gameTimeAbsences` so B3 can
 * spread it into an insert and diff existing rows by `startDate`/`endDate`.
 */
export interface DerivedAwayRange {
  /** Inclusive `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive `YYYY-MM-DD`. */
  endDate: string;
  /** Lowest contributing connection id (the row's FK). */
  calendarConnectionId: number;
}

interface Interval {
  start: number;
  end: number;
}

interface AwayDay {
  date: string;
  connectionId: number;
}

const DAY_MS = 24 * HOUR_MS;

/**
 * Hard cap on the span `expandDateRange` will list (~10 years) — far above
 * any derive window. Callers expanding user-supplied ranges clip them first
 * (`expandWithinWindow`), so hitting it is a caller bug: it throws rather
 * than silently truncating.
 */
export const MAX_EXPANDED_DAYS = 3660;

const toDayMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromDayMs = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

/**
 * Every date from `startDate` to `endDate` inclusive (`YYYY-MM-DD`); empty
 * when `start > end` or either date is unparseable. Counts epoch days, not
 * string steps: a string loop never ended at `9999-12-31` (its next day,
 * `'+010000-01'`, sorts before `'9999-12-31'` — ROK-1593 BLOCKER-1).
 *
 * @throws RangeError when the span exceeds `MAX_EXPANDED_DAYS`.
 */
export function expandDateRange(startDate: string, endDate: string): string[] {
  const startMs = toDayMs(startDate);
  const endMs = toDayMs(endDate);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  if (startMs > endMs) return [];
  const count = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (count > MAX_EXPANDED_DAYS) {
    throw new RangeError(
      `expandDateRange ${startDate}..${endDate} spans ${count} days (max ${MAX_EXPANDED_DAYS}); clip it first`,
    );
  }
  return Array.from({ length: count }, (_, i) =>
    fromDayMs(startMs + i * DAY_MS),
  );
}

/**
 * The dates of an inclusive range that fall inside the inclusive window
 * `[firstDate, lastDate]` — a range entirely outside it yields nothing.
 * Manual absences are clipped this way before expanding (BLOCKER-1): only
 * window dates can be derived, so nothing is lost.
 */
export function expandWithinWindow(
  range: { startDate: string; endDate: string },
  window: { firstDate: string; lastDate: string },
): string[] {
  const start =
    range.startDate > window.firstDate ? range.startDate : window.firstDate;
  const end = range.endDate < window.lastDate ? range.endDate : window.lastDate;
  return expandDateRange(start, end);
}

/** The calendar day before `date` (`YYYY-MM-DD`). */
export function previousCalendarDay(date: string): string {
  return fromDayMs(toDayMs(date) - DAY_MS);
}

/** Sorted union of intervals; touching intervals join (Q16 adjacency). */
function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const next of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

function groupTemplateHours(
  hours: readonly AwayTemplateHour[],
): Map<number, number[]> {
  const byDay = new Map<number, number[]>();
  for (const { dayOfWeek, startHour } of hours) {
    const list = byDay.get(dayOfWeek) ?? [];
    list.push(startHour);
    byDay.set(dayOfWeek, list);
  }
  return byDay;
}

/**
 * Local hour `[D h:00, D h+1:00)` as instants. Hour 23 ends at the next
 * local midnight (`zonedHourToUtc` accepts hour 24). In a spring-forward gap
 * the two bounds can collapse; the interval then spans one real hour so it
 * is never trivially covered.
 */
function hourInterval(dateStr: string, hour: number, tz: string): Interval {
  const start = zonedHourToUtc(dateStr, hour, tz).getTime();
  const end = zonedHourToUtc(dateStr, hour + 1, tz).getTime();
  return { start, end: end > start ? end : start + HOUR_MS };
}

function ruleAContributors(
  blocks: readonly AwayDeriveBlock[],
  date: string,
): number[] {
  return blocks
    .filter(
      (b) =>
        b.allDay &&
        b.firstDate !== null &&
        b.lastDate !== null &&
        b.firstDate <= date &&
        date <= b.lastDate,
    )
    .map((b) => b.connectionId);
}

function ruleBContributors(
  timed: readonly AwayDeriveBlock[],
  covered: readonly Interval[],
  hours: readonly Interval[],
): number[] {
  if (hours.length === 0) return [];
  const fullyCovered = hours.every((h) =>
    covered.some((c) => c.start <= h.start && c.end >= h.end),
  );
  if (!fullyCovered) return [];
  return timed
    .filter((b) =>
      hours.some(
        (h) => b.startsAt.getTime() < h.end && b.endsAt.getTime() > h.start,
      ),
    )
    .map((b) => b.connectionId);
}

function mergeConsecutive(days: readonly AwayDay[]): DerivedAwayRange[] {
  const ranges: DerivedAwayRange[] = [];
  for (const day of days) {
    const last = ranges[ranges.length - 1];
    if (last !== undefined && nextCalendarDay(last.endDate) === day.date) {
      last.endDate = day.date;
      last.calendarConnectionId = Math.min(
        last.calendarConnectionId,
        day.connectionId,
      );
    } else {
      ranges.push({
        startDate: day.date,
        endDate: day.date,
        calendarConnectionId: day.connectionId,
      });
    }
  }
  return ranges;
}

/** The lowest connection id that makes `day` away, or null if none does. */
function awayConnectionFor(
  day: ZonedDay,
  input: AwayDeriveInput,
  ctx: {
    timed: AwayDeriveBlock[];
    covered: Interval[];
    hoursByDay: Map<number, number[]>;
  },
): number | null {
  const hours = (ctx.hoursByDay.get(day.dayOfWeek) ?? []).map((h) =>
    hourInterval(day.dateStr, h, input.timeZone),
  );
  const ids = [
    ...ruleAContributors(input.blocks, day.dateStr),
    ...ruleBContributors(ctx.timed, ctx.covered, hours),
  ];
  return ids.length === 0 ? null : Math.min(...ids);
}

/**
 * §4.6: the user's synced away days as merged inclusive date ranges, oldest
 * first. Empty for mode `hours` or an empty window.
 */
export function deriveAwayRanges(input: AwayDeriveInput): DerivedAwayRange[] {
  const { start, end } = input.window;
  if (input.mode === 'hours' || end.getTime() <= start.getTime()) return [];
  const skip = new Set([...input.ignoredDates, ...input.manualDates]);
  const timed = input.blocks.filter((b) => !b.allDay);
  const ctx = {
    timed,
    covered: mergeIntervals(
      timed.map((b) => ({
        start: b.startsAt.getTime(),
        end: b.endsAt.getTime(),
      })),
    ),
    hoursByDay: groupTemplateHours(input.templateHours),
  };
  const days: AwayDay[] = [];
  for (const day of enumerateZonedDays(start, end, input.timeZone)) {
    if (skip.has(day.dateStr)) continue;
    const connectionId = awayConnectionFor(day, input, ctx);
    if (connectionId !== null) days.push({ date: day.dateStr, connectionId });
  }
  return mergeConsecutive(days);
}

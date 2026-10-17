/**
 * ROK-1593 A5 (epic ROK-669 §4.4.2 step 6): pure normalisation of the blocks
 * a provider's `fetchBusy` returned, before they replace the connection's
 * `calendar_busy_blocks`.
 *
 * - **R2:** a block carrying a copy id stamped by THIS instance is one of our
 *   own sign-up copies — dropped whether or not its link row still exists
 *   (orphan). A foreign instance's copy is someone else's commitment: kept.
 * - Cancelled / transparent / Maybe events never reach here: the adapter
 *   drops them (`BusyBlock` has no transparency field).
 * - Clip to the read window; merge overlapping intervals per all-day class.
 *
 * All-day blocks are re-derived from their DATES, never the instants: the
 * adapter reports UTC midnights, but the user's day starts at local midnight.
 */
import { LOOK_AHEAD_DAYS } from '../calendar-sync.constants';
import type { BusyBlock } from '../providers/calendar-provider.interface';
import { parseCopyId } from '../providers/rl-copy-id.helpers';
import {
  nextCalendarDay,
  zonedDayKey,
  zonedHourToUtc,
} from '../../lfg/lfg-zoned-time.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `[start, end)` from local midnight today; dates are inclusive. */
export interface ReadWindow {
  start: Date;
  end: Date;
  firstDate: string;
  lastDate: string;
  timeZone: string;
}

/** One `calendar_busy_blocks` row minus ids. */
export interface NormalizedBusyBlock {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  firstDate: string | null;
  lastDate: string | null;
}

export interface NormalizeOptions {
  instanceId: string;
  window: ReadWindow;
}

function addDays(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`) + days * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** §4.4.2 step 3: `[startOfLocalDay(now, tz), + LOOK_AHEAD_DAYS days)`. */
export function buildReadWindow(
  now: Date,
  timeZone: string,
  days: number = LOOK_AHEAD_DAYS,
): ReadWindow {
  const firstDate = zonedDayKey(now, timeZone);
  return {
    start: zonedHourToUtc(firstDate, 0, timeZone),
    end: zonedHourToUtc(addDays(firstDate, days), 0, timeZone),
    firstDate,
    lastDate: addDays(firstDate, days - 1),
    timeZone,
  };
}

/** R2: true only for a copy id written by this instance. */
export function isOwnCopy(block: BusyBlock, instanceId: string): boolean {
  if (block.ourId === undefined) return false;
  return parseCopyId(block.ourId, instanceId) !== null;
}

function allDayRow(first: string, last: string, tz: string) {
  return {
    startsAt: zonedHourToUtc(first, 0, tz),
    endsAt: zonedHourToUtc(nextCalendarDay(last), 0, tz),
    allDay: true,
    firstDate: first,
    lastDate: last,
  };
}

function clipTimed(b: BusyBlock, w: ReadWindow): NormalizedBusyBlock | null {
  const s = Math.max(b.start.getTime(), w.start.getTime());
  const e = Math.min(b.end.getTime(), w.end.getTime());
  if (!(e > s)) return null;
  const row = { startsAt: new Date(s), endsAt: new Date(e), allDay: false };
  return { ...row, firstDate: null, lastDate: null };
}

function clipAllDay(b: BusyBlock, w: ReadWindow): NormalizedBusyBlock | null {
  const d = b.allDayDates;
  if (!d || !DATE_RE.test(d.first) || !DATE_RE.test(d.lastInclusive)) {
    return null;
  }
  const first = d.first > w.firstDate ? d.first : w.firstDate;
  const last = d.lastInclusive < w.lastDate ? d.lastInclusive : w.lastDate;
  return first <= last ? allDayRow(first, last, w.timeZone) : null;
}

function mergeTimed(rows: NormalizedBusyBlock[]): NormalizedBusyBlock[] {
  const sorted = [...rows].sort((a, b) => +a.startsAt - +b.startsAt);
  const out: NormalizedBusyBlock[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startsAt <= last.endsAt) {
      if (r.endsAt > last.endsAt) last.endsAt = r.endsAt;
    } else out.push({ ...r });
  }
  return out;
}

function mergeAllDay(
  rows: NormalizedBusyBlock[],
  tz: string,
): NormalizedBusyBlock[] {
  const sorted = [...rows].sort((a, b) =>
    (a.firstDate ?? '').localeCompare(b.firstDate ?? ''),
  );
  const out: NormalizedBusyBlock[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const first = r.firstDate ?? '';
    const lastDate = r.lastDate ?? '';
    if (last?.lastDate && first <= nextCalendarDay(last.lastDate)) {
      const end = lastDate > last.lastDate ? lastDate : last.lastDate;
      out[out.length - 1] = allDayRow(last.firstDate ?? first, end, tz);
    } else out.push({ ...r });
  }
  return out;
}

/** §4.4.2 step 6: R2, clip, merge per all-day class. */
export function normalizeBusyBlocks(
  blocks: readonly BusyBlock[],
  opts: NormalizeOptions,
): NormalizedBusyBlock[] {
  const timed: NormalizedBusyBlock[] = [];
  const allDay: NormalizedBusyBlock[] = [];
  for (const b of blocks) {
    if (isOwnCopy(b, opts.instanceId)) continue;
    const row = b.allDay
      ? clipAllDay(b, opts.window)
      : clipTimed(b, opts.window);
    if (row) (row.allDay ? allDay : timed).push(row);
  }
  return [...mergeTimed(timed), ...mergeAllDay(allDay, opts.window.timeZone)];
}

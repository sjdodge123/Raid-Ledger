/**
 * ROK-1598 §2.4 (L2): one VEVENT series → its busy occurrences in a window.
 *
 * ical.js expands RRULE + RDATE − EXDATE; `RECURRENCE-ID` overrides are
 * related to the master (`ICAL.Event` `exceptions`) so the iterator's
 * occurrence for an overridden instance is skipped here and the override is
 * judged on its OWN times — moved out of the window → excluded, moved into
 * it → included, `STATUS:CANCELLED` → that occurrence is gone.
 *
 * Occurrences are produced as wall-clock times in the series' TZID and only
 * then converted to UTC, so a weekly 19:00 New York event is 23:00Z before
 * the DST end and 00:00Z after it.
 *
 * Cap: MAX_SERIES_ITERATIONS iterator steps per series, counted from the
 * series' DTSTART (ical.js cannot start mid-series without breaking
 * INTERVAL / BYSETPOS phase). 20 000 covers a daily series ~54 years old or
 * an hourly one ~2 years old and costs ~75 ms worst case; a series that
 * hits it keeps the blocks found so far and is counted in `skipped`.
 */
import ICAL from 'ical.js';
import type { BusyBlock, TimeRange } from '../calendar-provider.interface';
import {
  DAY_MS,
  addDays,
  dateOf,
  timeToMs,
  type FloatingZone,
} from './apple-ical-time.helpers';

export const MAX_SERIES_ITERATIONS = 20_000;

export type RawBlock = Omit<BusyBlock, 'ourId'>;

export interface SeriesContext {
  range: TimeRange;
  floating: FloatingZone;
  /** STATUS / TRANSP rule, owned by the parse layer. */
  isBusy: (vevent: ICAL.Component) => boolean;
}

export interface SeriesResult {
  blocks: RawBlock[];
  skipped: number;
}

type Timing =
  | { allDay: true; days: number }
  | { allDay: false; durationMs: number; tzid: string | null };

interface Start {
  time: ICAL.Time;
  timing: Timing;
}

function tzidOf(prop: ICAL.Property): string | null {
  const raw = prop.getParameter('tzid');
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function timeProp(
  vevent: ICAL.Component,
  name: string,
): { time: ICAL.Time; tzid: string | null } | null {
  const prop = vevent.getFirstProperty(name);
  const value = prop?.getFirstValue();
  if (!prop || !(value instanceof ICAL.Time)) return null;
  return { time: value, tzid: tzidOf(prop) };
}

function durationMsOf(vevent: ICAL.Component): number | null {
  const value = vevent.getFirstPropertyValue('duration');
  return value instanceof ICAL.Duration ? value.toSeconds() * 1000 : null;
}

function allDayDays(vevent: ICAL.Component, start: ICAL.Time): number {
  const end = timeProp(vevent, 'dtend');
  const first = Date.parse(`${dateOf(start)}T00:00:00Z`);
  if (end?.time.isDate) {
    return Math.round(
      (Date.parse(`${dateOf(end.time)}T00:00:00Z`) - first) / DAY_MS,
    );
  }
  const duration = durationMsOf(vevent);
  return duration === null ? 1 : Math.floor(duration / DAY_MS);
}

/** DTSTART + DTEND | DURATION | nothing. 'bad' → skipped; 'drop' → empty. */
function readStart(
  vevent: ICAL.Component,
  floating: FloatingZone,
): Start | 'bad' | 'drop' {
  const start = timeProp(vevent, 'dtstart');
  if (!start) return 'bad';
  if (start.time.isDate) {
    const days = allDayDays(vevent, start.time);
    return days > 0
      ? { time: start.time, timing: { allDay: true, days } }
      : 'drop';
  }
  const startMs = timeToMs(start.time, start.tzid, floating);
  if (startMs === null) return 'bad';
  const end = timeProp(vevent, 'dtend');
  const endMs = end
    ? timeToMs(end.time, end.tzid, floating)
    : startMs + (durationMsOf(vevent) ?? 0);
  if (endMs === null) return 'bad';
  if (endMs <= startMs) return 'drop';
  const timing = {
    allDay: false as const,
    durationMs: endMs - startMs,
    tzid: start.tzid,
  };
  return { time: start.time, timing };
}

function blockAt(
  t: ICAL.Time,
  timing: Timing,
  floating: FloatingZone,
): RawBlock | null {
  if (timing.allDay) {
    const first = dateOf(t);
    const startMs = Date.parse(`${first}T00:00:00Z`);
    return {
      start: new Date(startMs),
      end: new Date(startMs + timing.days * DAY_MS),
      allDay: true,
      allDayDates: { first, lastInclusive: addDays(first, timing.days - 1) },
    };
  }
  const startMs = timeToMs(t, timing.tzid, floating);
  if (startMs === null) return null;
  return {
    start: new Date(startMs),
    end: new Date(startMs + timing.durationMs),
    allDay: false,
  };
}

function overlaps(block: RawBlock, range: TimeRange): boolean {
  return block.end > range.start && block.start < range.end;
}

/** A VEVENT judged on its own times (a single event or an override). */
function singleOccurrence(
  vevent: ICAL.Component,
  ctx: SeriesContext,
): SeriesResult {
  if (!ctx.isBusy(vevent)) return { blocks: [], skipped: 0 };
  const start = readStart(vevent, ctx.floating);
  if (start === 'bad') return { blocks: [], skipped: 1 };
  if (start === 'drop') return { blocks: [], skipped: 0 };
  const block = blockAt(start.time, start.timing, ctx.floating);
  if (!block) return { blocks: [], skipped: 1 };
  return { blocks: overlaps(block, ctx.range) ? [block] : [], skipped: 0 };
}

function iterateMaster(
  event: ICAL.Event,
  start: Start,
  ctx: SeriesContext,
): SeriesResult {
  const blocks: RawBlock[] = [];
  const it = event.iterator();
  for (let i = 0; i < MAX_SERIES_ITERATIONS; i++) {
    const t = it.next();
    if (!t) return { blocks, skipped: 0 };
    if (event.getOccurrenceDetails(t).item !== event) continue;
    const block = blockAt(t, start.timing, ctx.floating);
    if (!block) return { blocks, skipped: 1 };
    if (block.start >= ctx.range.end) return { blocks, skipped: 0 };
    if (overlaps(block, ctx.range)) blocks.push(block);
  }
  return { blocks, skipped: 1 };
}

function merge(results: SeriesResult[]): SeriesResult {
  return {
    blocks: results.flatMap((r) => r.blocks),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
  };
}

/** One UID group: the master (when present) plus its overrides. */
export function expandSeries(
  master: ICAL.Component | null,
  overrides: ICAL.Component[],
  ctx: SeriesContext,
): SeriesResult {
  const own = overrides.map((o) => singleOccurrence(o, ctx));
  if (!master) return merge(own);
  const event = new ICAL.Event(master, {
    exceptions: overrides,
    strictExceptions: false,
  });
  if (!event.isRecurring())
    return merge([singleOccurrence(master, ctx), ...own]);
  if (!ctx.isBusy(master)) return merge(own);
  const start = readStart(master, ctx.floating);
  if (start === 'bad') return merge([{ blocks: [], skipped: 1 }, ...own]);
  if (start === 'drop') return merge(own);
  return merge([iterateMaster(event, start, ctx), ...own]);
}

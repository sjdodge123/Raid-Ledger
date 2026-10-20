/**
 * ROK-1598 §2.4 (L2): one VEVENT series → its busy occurrences in a window.
 *
 * ical.js expands RRULE + RDATE − EXDATE; `RECURRENCE-ID` overrides are
 * related to the master (`ICAL.Event` `exceptions`) so the iterator's
 * occurrence for an overridden instance is skipped here and the override is
 * judged on its OWN times — moved out of the window → excluded, moved into
 * it → included, `STATUS:CANCELLED` → that occurrence is gone.
 *
 * A `RANGE=THISANDFUTURE` override also moves every later occurrence: those
 * take the adjusted start/end ical.js reports for them (the override itself
 * is still judged on its own times).
 *
 * Occurrences are produced as wall-clock times in the series' TZID and only
 * then converted to UTC, so a weekly 19:00 New York event is 23:00Z before
 * the DST end and 00:00Z after it. A `DURATION`'s day/week part is nominal
 * (RFC 5545 §3.3.6): it is added on the wall clock in that zone, and only
 * the hour/minute/second part as exact time.
 *
 * An IANA TZID with no VTIMEZONE: UNTIL / EXDATE / RDATE are first moved
 * onto the series' wall clock (`alignSeriesZone`). RDATE-only series also
 * yield DTSTART, which ical.js's iterator leaves out. Codex r3: period
 * RDATEs keep their own end (`normalizePeriodRdates`); a TRANSPARENT /
 * cancelled master still expands when a busy THISANDFUTURE override takes
 * over its later occurrences (TRANSP / STATUS judged per occurrence).
 *
 * Cap: MAX_SERIES_ITERATIONS iterator steps per series, counted from the
 * series' DTSTART (ical.js cannot start mid-series without breaking
 * INTERVAL / BYSETPOS phase). 20 000 covers a daily series ~54 years old or
 * an hourly one ~2 years old and costs ~75 ms worst case; a series that
 * hits it keeps the blocks found so far and is counted in `skipped`.
 * Codex r8: a rule whose single ical.js step is itself unbounded is refused
 * before iterating (`isCostlyRule`).
 */
import ICAL from 'ical.js';
import type { BusyBlock, TimeRange } from '../calendar-provider.interface';
import {
  normalizePeriodRdates,
  splitDuration,
  type PeriodEnds,
} from './apple-ical-rdate-period.helpers';
import {
  isThisAndFuture,
  maxBackwardShiftMs,
} from './apple-ical-range-shift.helpers';
import { isCostlyRule } from './apple-ical-recur-cost.helpers';
import { alignSeriesZone } from './apple-ical-series-zone.helpers';
import { masterTimes } from './apple-ical-series-times.helpers';
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

/** Timed: end = start + `days` on the wall clock, then + `exactMs`. */
type Timing =
  | { allDay: true; days: number }
  | { allDay: false; days: number; exactMs: number; tzid: string | null };

interface DurationParts {
  days: number;
  exactMs: number;
}

interface Start {
  time: ICAL.Time;
  timing: Timing;
  /** Period RDATE occurrences: start ms → their own end ms. */
  periodEnds: PeriodEnds;
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

/** DURATION split into its nominal day part and its exact time part. */
function durationParts(vevent: ICAL.Component): DurationParts {
  const d = vevent.getFirstPropertyValue('duration');
  return d instanceof ICAL.Duration
    ? splitDuration(d)
    : { days: 0, exactMs: 0 };
}

/** The end instant of a timed occurrence starting at `t` (= `startMs`). */
function endMsOf(
  t: ICAL.Time,
  startMs: number,
  timing: Extract<Timing, { allDay: false }>,
  floating: FloatingZone,
): number | null {
  if (timing.days === 0) return startMs + timing.exactMs;
  const shifted = t.clone();
  shifted.adjust(timing.days, 0, 0, 0);
  const base = timeToMs(shifted, timing.tzid, floating);
  return base === null ? null : base + timing.exactMs;
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

/**
 * DTSTART + DTEND | DURATION | nothing. 'bad' → skipped; 'drop' → empty.
 * `keepEmpty` (Codex r5): a zero-length master still expands when a
 * THISANDFUTURE override can give its later occurrences a duration.
 */
function readStart(
  vevent: ICAL.Component,
  floating: FloatingZone,
  periodEnds: PeriodEnds = new Map(),
  keepEmpty = false,
): Start | 'bad' | 'drop' {
  const start = timeProp(vevent, 'dtstart');
  if (!start) return 'bad';
  if (start.time.isDate) {
    const days = allDayDays(vevent, start.time);
    return days > 0
      ? { time: start.time, timing: { allDay: true, days }, periodEnds }
      : 'drop';
  }
  const startMs = timeToMs(start.time, start.tzid, floating);
  if (startMs === null) return 'bad';
  const end = timeProp(vevent, 'dtend');
  const exactEnd = end ? timeToMs(end.time, end.tzid, floating) : 0;
  if (exactEnd === null) return 'bad';
  const parts = end
    ? { days: 0, exactMs: exactEnd - startMs }
    : durationParts(vevent);
  const timing = { allDay: false as const, ...parts, tzid: start.tzid };
  const endMs = endMsOf(start.time, startMs, timing, floating);
  if (endMs === null) return 'bad';
  // Codex r4: an empty master still expands its positive period RDATEs.
  const empty = endMs <= startMs && periodEnds.size === 0 && !keepEmpty;
  return empty ? 'drop' : { time: start.time, timing, periodEnds };
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
  const endMs = endMsOf(t, startMs, timing, floating);
  if (endMs === null) return null;
  return { start: new Date(startMs), end: new Date(endMs), allDay: false };
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

/** The override's own timed span (DTEND exact, DURATION nominal days). */
function overrideTiming(
  vevent: ICAL.Component,
  floating: FloatingZone,
): Extract<Timing, { allDay: false }> | null {
  const own = readStart(vevent, floating, new Map(), true);
  return typeof own === 'object' && !own.timing.allDay ? own.timing : null;
}

/**
 * A later occurrence moved by a `RANGE=THISANDFUTURE` override: ical.js has
 * already shifted its start by the override's change. Codex r6: its end is
 * the override's own span added like `endMsOf` (ical.js adds it on the wall
 * clock, so a PT24H crossing a DST change gained an hour). 'skip' = not busy
 * (or empty); null = unplaceable.
 */
function rangeBlock(
  item: ICAL.Event,
  startDate: ICAL.Time,
  endDate: ICAL.Time,
  ctx: SeriesContext,
): RawBlock | null | 'skip' {
  if (!ctx.isBusy(item.component)) return 'skip';
  const tzid = timeProp(item.component, 'dtstart')?.tzid ?? null;
  if (startDate.isDate) {
    const days = allDayDays(item.component, item.startDate);
    return days > 0
      ? blockAt(startDate, { allDay: true, days }, ctx.floating)
      : 'skip';
  }
  const startMs = timeToMs(startDate, tzid, ctx.floating);
  if (startMs === null) return null;
  const timing = overrideTiming(item.component, ctx.floating);
  const endMs = timing
    ? endMsOf(startDate, startMs, timing, ctx.floating)
    : timeToMs(endDate, tzid, ctx.floating);
  if (endMs === null) return null;
  if (endMs <= startMs) return 'skip';
  return { start: new Date(startMs), end: new Date(endMs), allDay: false };
}

interface Details {
  item: ICAL.Event;
  startDate: ICAL.Time;
  endDate: ICAL.Time;
}

/** `getOccurrenceDetails`, narrowed (its typedef does not resolve for lint). */
function detailsOf(event: ICAL.Event, t: ICAL.Time): Details | null {
  const raw: unknown = event.getOccurrenceDetails(t);
  if (typeof raw !== 'object' || raw === null) return null;
  const item: unknown = 'item' in raw ? raw.item : null;
  const startDate: unknown = 'startDate' in raw ? raw.startDate : null;
  const endDate: unknown = 'endDate' in raw ? raw.endDate : null;
  if (!(item instanceof ICAL.Event)) return null;
  if (!(startDate instanceof ICAL.Time) || !(endDate instanceof ICAL.Time)) {
    return null;
  }
  return { item, startDate, endDate };
}

/** A master-owned step: not busy → 'skip'; a period RDATE keeps its end. */
function masterBlock(
  event: ICAL.Event,
  t: ICAL.Time,
  start: Start,
  ctx: SeriesContext,
): RawBlock | null | 'skip' {
  if (!ctx.isBusy(event.component)) return 'skip';
  const block = blockAt(t, start.timing, ctx.floating);
  const periodEnd = block && start.periodEnds.get(block.start.getTime());
  return block && periodEnd ? { ...block, end: new Date(periodEnd) } : block;
}

/** One iterator step → its block; 'skip' = an override judges it instead. */
function occurrenceBlock(
  event: ICAL.Event,
  t: ICAL.Time,
  start: Start,
  ctx: SeriesContext,
): RawBlock | null | 'skip' {
  const d = detailsOf(event, t);
  if (!d) return null;
  if (d.item === event) return masterBlock(event, t, start, ctx);
  const exact = d.item.recurrenceId?.toUnixTime() === t.toUnixTime();
  if (exact || !d.item.modifiesFuture()) return 'skip';
  return rangeBlock(d.item, d.startDate, d.endDate, ctx);
}

/** `t`'s unshifted start is past the window by more than `backMs`. */
function pastWindow(
  t: ICAL.Time,
  start: Start,
  ctx: SeriesContext,
  backMs: number,
): boolean {
  const own = blockAt(t, start.timing, ctx.floating);
  return !own || own.start.getTime() >= ctx.range.end.getTime() + backMs;
}

/**
 * `backMs`: a later THISANDFUTURE override may pull occurrences back into
 * the window (Codex r4), so an out-of-window block ends the walk only once
 * no pending shift can. Zero-length occurrences are never busy.
 */
function iterateMaster(
  event: ICAL.Event,
  start: Start,
  ctx: SeriesContext,
  backMs: number,
): SeriesResult {
  const blocks: RawBlock[] = [];
  const times = masterTimes(event);
  // Codex r8: the cap is checked BEFORE each step, never after it.
  for (let steps = 0; steps < MAX_SERIES_ITERATIONS; steps++) {
    const next = times.next();
    if (next.done) return { blocks, skipped: 0 };
    const t = next.value;
    const block = occurrenceBlock(event, t, start, ctx);
    if (block === 'skip') continue;
    if (!block) return { blocks, skipped: 1 };
    if (block.start >= ctx.range.end) {
      if (pastWindow(t, start, ctx, backMs)) return { blocks, skipped: 0 };
      continue;
    }
    if (block.end > block.start && overlaps(block, ctx.range)) {
      blocks.push(block);
    }
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
  const periodEnds = normalizePeriodRdates(master, ctx.floating);
  alignSeriesZone(master, ctx.floating, overrides);
  const event = new ICAL.Event(master, {
    exceptions: overrides,
    strictExceptions: false,
  });
  if (!event.isRecurring())
    return merge([singleOccurrence(master, ctx), ...own]);
  if (
    !ctx.isBusy(master) &&
    !overrides.some((o) => isThisAndFuture(o) && ctx.isBusy(o))
  ) {
    return merge(own);
  }
  const ranged = overrides.some(isThisAndFuture);
  const start = readStart(master, ctx.floating, periodEnds, ranged);
  if (start === 'bad' || isCostlyRule(master, ctx.range.end)) {
    return merge([{ blocks: [], skipped: 1 }, ...own]);
  }
  if (start === 'drop') return merge(own);
  const backMs = maxBackwardShiftMs(overrides, ctx.floating);
  return merge([iterateMaster(event, start, ctx, backMs), ...own]);
}

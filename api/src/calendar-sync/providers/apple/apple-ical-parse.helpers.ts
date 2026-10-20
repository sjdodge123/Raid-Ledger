/**
 * ROK-1598 §2.4 + D4/D5 (L2): CalDAV calendar-data → busy blocks.
 *
 * Pure. The `ICAL.Component` tree never leaves this module family; the
 * extraction layer reads ONLY DTSTART, DTEND, DURATION, RRULE, RDATE,
 * EXDATE, RECURRENCE-ID, TRANSP, STATUS, UID and X-RAID-LEDGER-ID. SUMMARY,
 * DESCRIPTION, LOCATION, ATTENDEE, ORGANIZER, URL, ATTACH and VALARM are
 * never read into a returned value (§6.4.1).
 *
 * - `STATUS:CANCELLED` and `TRANSP:TRANSPARENT` (Free — includes our own
 *   tentative / bench copies) are dropped; `STATUS:TENTATIVE` + opaque is
 *   busy (matches Google, which keys on transparency only).
 * - Never throws on input: one unparseable VCALENDAR, or one series with
 *   unusable times / an unresolvable TZID / an exhausted recurrence cap,
 *   counts in `skipped` and the rest still parse.
 * - Clips nothing — window clipping is `normalizeBusyBlocks`' job; blocks
 *   that do not overlap `range` are simply not returned.
 */
import ICAL from 'ical.js';
import type { BusyBlock, TimeRange } from '../calendar-provider.interface';
import {
  buildCopyId,
  decodeCopyId,
  deriveInstanceId,
} from '../rl-copy-id.helpers';
import { parseIcsRoot } from './apple-ical-time.helpers';
import {
  dropCostlyTimezones,
  safeFloatingZone,
} from './apple-ical-vtimezone-guard.helpers';
import { expandSeries, type SeriesContext } from './apple-ical-recur.helpers';

export interface IcsParseContext {
  range: TimeRange;
  /** The collection's `C:calendar-timezone` (IANA name or VTIMEZONE text). */
  calendarTimezone: string | null;
}

export interface IcsParseResult {
  blocks: BusyBlock[];
  skipped: number;
}

/** Legacy one-event download UID (`rl-<eventId>-<userId>@<host>`, D5 step 3). */
const LEGACY_UID = /^rl-([1-9]\d{0,15})-([1-9]\d{0,15})@([^\s@]{1,253})$/;

function textValue(vevent: ICAL.Component, name: string): string | null {
  const value = vevent.getFirstPropertyValue(name);
  return typeof value === 'string' ? value.trim() : null;
}

/** D5: X-RAID-LEDGER-ID, else a copy-id UID, else a legacy UID. */
export function ourIdFrom(
  xId: string | null,
  uid: string | null,
): string | undefined {
  if (xId !== null && decodeCopyId(xId)) return xId;
  if (uid === null) return undefined;
  if (decodeCopyId(uid)) return uid;
  const m = LEGACY_UID.exec(uid);
  const host = m?.[3];
  if (!m || !host) return undefined;
  try {
    const instanceId = deriveInstanceId(host);
    return buildCopyId({
      instanceId,
      eventId: Number(m[1]),
      userId: Number(m[2]),
    });
  } catch {
    return undefined;
  }
}

function isBusy(vevent: ICAL.Component): boolean {
  if (textValue(vevent, 'status')?.toUpperCase() === 'CANCELLED') return false;
  return textValue(vevent, 'transp')?.toUpperCase() !== 'TRANSPARENT';
}

interface Series {
  master: ICAL.Component | null;
  overrides: ICAL.Component[];
}

function groupByUid(vevents: ICAL.Component[]): Series[] {
  const byUid = new Map<string, Series>();
  const loose: Series[] = [];
  for (const vevent of vevents) {
    const uid = textValue(vevent, 'uid');
    const isOverride = vevent.hasProperty('recurrence-id');
    const series: Series = (uid !== null ? byUid.get(uid) : undefined) ?? {
      master: null,
      overrides: [],
    };
    if (uid === null) loose.push(series);
    else byUid.set(uid, series);
    if (isOverride) series.overrides.push(vevent);
    else if (series.master === null) series.master = vevent;
    else loose.push({ master: vevent, overrides: [] });
  }
  return [...byUid.values(), ...loose];
}

function seriesOurId(series: Series): string | undefined {
  const head = series.master ?? series.overrides[0];
  if (!head) return undefined;
  return ourIdFrom(textValue(head, 'x-raid-ledger-id'), textValue(head, 'uid'));
}

function parseSeries(series: Series, ctx: SeriesContext): IcsParseResult {
  try {
    const result = expandSeries(series.master, series.overrides, ctx);
    const ourId = seriesOurId(series);
    const blocks = result.blocks.map((b) => ({
      ...b,
      ...(ourId !== undefined ? { ourId } : {}),
    }));
    return { blocks, skipped: result.skipped };
  } catch {
    return { blocks: [], skipped: 1 };
  }
}

/** Split concatenated calendar objects so one bad object spares the rest. */
function splitCalendars(ics: string): string[] {
  const chunks = ics
    .split(/(?=^BEGIN:VCALENDAR\r?$)/im)
    .filter((chunk) => /BEGIN:VCALENDAR/i.test(chunk));
  // Non-empty text with no VCALENDAR at all → one (failing) object.
  return chunks.length === 0 && ics.trim() !== '' ? [ics] : chunks;
}

function parseCalendar(text: string, ctx: SeriesContext): IcsParseResult {
  const root = parseIcsRoot(text);
  if (!root) return { blocks: [], skipped: 1 };
  // Codex r11: before ANY event time is converted through a VTIMEZONE.
  dropCostlyTimezones(root, ctx.range.end);
  const results = groupByUid(root.getAllSubcomponents('vevent')).map((s) =>
    parseSeries(s, ctx),
  );
  return {
    blocks: results.flatMap((r) => r.blocks),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
  };
}

/** The only export the adapter uses (spec §2.4). */
export function parseBusyFromIcs(
  ics: string,
  ctx: IcsParseContext,
): IcsParseResult {
  const series: SeriesContext = {
    range: ctx.range,
    floating: safeFloatingZone(ctx.calendarTimezone, ctx.range.end),
    isBusy,
  };
  const results = splitCalendars(ics).map((c) => parseCalendar(c, series));
  return {
    blocks: results.flatMap((r) => r.blocks),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
  };
}

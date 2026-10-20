/**
 * ROK-1598 (spec §2.6, D7–D9): the read half of the Apple adapter — the
 * calendar picker rows, the ctag cursor and the per-calendar REPORT loop.
 * Nothing here reads a title: only busy intervals leave `parseBusyFromIcs`.
 */
import {
  NotFoundError,
  ProviderRequestError,
  TransientError,
} from '../calendar-provider.errors';
import type {
  BusyBlock,
  FetchBusyResult,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import type { CalDavAuth } from './apple-caldav-http';
import { queryEvents } from './apple-caldav-client.helpers';
import type { CalDavCollection } from './apple-caldav-xml.helpers';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';

/** D8: the user's main calendar is `home`; failing that, the first by href. */
export const APPLE_PRIMARY_CALENDAR_ID = 'home';

const WINDOW_KEY = 'w';
const ctagKey = (calendarId: string) => `c:${calendarId}`;

function primaryId(cols: CalDavCollection[]): string | null {
  if (cols.some((c) => c.id === APPLE_PRIMARY_CALENDAR_ID)) {
    return APPLE_PRIMARY_CALENDAR_ID;
  }
  const first = [...cols].sort((a, b) => a.href.localeCompare(b.href))[0];
  return first?.id ?? null;
}

/** D8 + D9: picker rows; the caller flags the dedicated calendar. */
export function toProviderCalendars(
  cols: CalDavCollection[],
): ProviderCalendar[] {
  const primary = primaryId(cols);
  return cols.map((c) => ({
    id: c.id,
    name: c.displayName,
    primary: c.id === primary,
    writable: c.writable,
    isRaidLedger: false,
  }));
}

/** D7: `{ w: '<start>/<end>', 'c:<id>': '<ctag>' }` for the requested ids. */
export function buildCursor(
  range: TimeRange,
  calendarIds: string[],
  cols: CalDavCollection[],
): Record<string, string> {
  const cursor: Record<string, string> = {
    [WINDOW_KEY]: `${range.start.toISOString()}/${range.end.toISOString()}`,
  };
  for (const id of calendarIds) {
    const ctag = cols.find((c) => c.id === id)?.ctag;
    if (ctag) cursor[ctagKey(id)] = ctag;
  }
  return cursor;
}

/**
 * D7: unchanged only when the window matches, every requested calendar has
 * a ctag, the ctag key set is exactly the requested ids, and each matches.
 */
export function isUnchanged(
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
  calendarIds: string[],
): boolean {
  if (!prev || calendarIds.length === 0) return false;
  const keys = Object.keys(next);
  if (keys.length !== new Set(calendarIds).size + 1) return false;
  if (Object.keys(prev).length !== keys.length) return false;
  return keys.every((k) => prev[k] === next[k]);
}

export interface AppleReadOutcome {
  blocks: BusyBlock[];
  missing: string[];
  refused: string[];
  skipped: number;
}

type CalendarRead =
  | { kind: 'ok'; blocks: BusyBlock[]; skipped: number }
  | { kind: 'missing' }
  | { kind: 'refused' };

const MISSING: CalendarRead = { kind: 'missing' };

async function readOne(
  auth: CalDavAuth,
  col: CalDavCollection,
  range: TimeRange,
): Promise<CalendarRead> {
  try {
    const objects = await queryEvents(auth, col.href, range);
    const ctx = { range, calendarTimezone: col.timezone };
    const parsed = objects.map((o) => parseBusyFromIcs(o.ics, ctx));
    return {
      kind: 'ok',
      blocks: parsed.flatMap((p) => p.blocks),
      skipped: parsed.reduce((n, p) => n + p.skipped, 0),
    };
  } catch (err) {
    if (err instanceof NotFoundError) return { kind: 'missing' };
    if (err instanceof ProviderRequestError && err.reason === 'caldav_403') {
      return { kind: 'refused' };
    }
    throw err;
  }
}

/** REPORT every requested calendar; gone → missing, 403 → refused. */
export async function readCalendars(
  auth: CalDavAuth,
  cols: CalDavCollection[],
  calendarIds: string[],
  range: TimeRange,
): Promise<AppleReadOutcome> {
  const out: AppleReadOutcome = {
    blocks: [],
    missing: [],
    refused: [],
    skipped: 0,
  };
  for (const id of calendarIds) {
    const col = cols.find((c) => c.id === id);
    const res = col ? await readOne(auth, col, range) : MISSING;
    if (res.kind === 'missing') out.missing.push(id);
    else if (res.kind === 'refused') out.refused.push(id);
    else {
      out.blocks.push(...res.blocks);
      out.skipped += res.skipped;
    }
  }
  return out;
}

/** The cursor minus the ctags of calendars that were not actually read. */
function readCursor(
  cursor: Record<string, string>,
  unread: string[],
): Record<string, string> {
  const out = { ...cursor };
  for (const id of unread) delete out[ctagKey(id)];
  return out;
}

/**
 * Every requested calendar refused (or refused + gone) → nothing was read:
 * fail transiently so the last good blocks stay (as `google.adapter.ts`).
 * A partial read drops the unread calendars' ctags from the cursor, so the
 * next run is never an unchanged hit and retries their REPORT.
 */
export function toFetchBusyResult(
  calendarIds: string[],
  out: AppleReadOutcome,
  cursor: Record<string, string>,
): FetchBusyResult {
  const { refused, missing } = out;
  if (
    refused.length > 0 &&
    refused.length + missing.length === calendarIds.length
  ) {
    throw new TransientError('caldav_403');
  }
  return {
    blocks: out.blocks,
    cursor: readCursor(cursor, [...refused, ...missing]),
    ...(missing.length > 0 ? { missingCalendarIds: missing } : {}),
    ...(refused.length > 0 ? { unreadableCalendarIds: refused } : {}),
  };
}

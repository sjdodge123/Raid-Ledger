/**
 * ROK-1597 spec §3.2: Graph reads behind the read capability — the calendar
 * list for the picker and `calendarView` (recurring series expanded
 * server-side) for busy time. Every call goes through `graphRequest` (the
 * spied `microsoft-http` seam) with `MICROSOFT_READ_PREFER`.
 *
 * Status map (read): `assertGraphOk(res, 'read')`, except a 403
 * `ErrorAccessDenied` on one calendar's `calendarView` (a shared calendar we
 * may not read), which `readCalendarOrSkip` turns into a per-calendar skip.
 * Nothing here logs; errors carry only a sanitised reason.
 */
import { NotFoundError, TransientError } from '../calendar-provider.errors';
import type {
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import {
  assertGraphOk,
  graphRequest,
  isGraphAccessDenied,
} from './microsoft-graph-errors.helpers';
import {
  GRAPH_API,
  MICROSOFT_CALENDARS_PAGE_SIZE,
  MICROSOFT_CALENDARS_SELECT,
  MICROSOFT_EVENTS_EXPAND,
  MICROSOFT_EVENTS_PAGE_SIZE,
  MICROSOFT_EVENTS_SELECT,
  MICROSOFT_READ_MAX_PAGES,
  MICROSOFT_READ_PREFER,
} from './microsoft-graph.constants';

/** Reason of the per-calendar refusal (and of the all-refused failure). */
export const GRAPH_ACCESS_DENIED = 'error_access_denied';

type Json = Record<string, unknown>;
export interface GraphPages {
  items: unknown[];
  truncated: boolean;
}

/** `GET /me/calendars` — every calendar of the signed-in user. */
export function buildCalendarListUrl(): string {
  return (
    `${GRAPH_API}/me/calendars?$select=${MICROSOFT_CALENDARS_SELECT}` +
    `&$top=${MICROSOFT_CALENDARS_PAGE_SIZE}`
  );
}

/**
 * `calendarView` of one calendar over `[range.start, range.end)`. The
 * `primary` alias maps to `/me/calendar` (the default calendar).
 */
export function buildCalendarViewUrl(
  calendarId: string,
  range: TimeRange,
): string {
  const base =
    calendarId === 'primary'
      ? `${GRAPH_API}/me/calendar`
      : `${GRAPH_API}/me/calendars/${encodeURIComponent(calendarId)}`;
  return (
    `${base}/calendarView` +
    `?startDateTime=${encodeURIComponent(range.start.toISOString())}` +
    `&endDateTime=${encodeURIComponent(range.end.toISOString())}` +
    `&$select=${MICROSOFT_EVENTS_SELECT}` +
    `&$expand=${encodeURIComponent(MICROSOFT_EVENTS_EXPAND)}` +
    `&$top=${MICROSOFT_EVENTS_PAGE_SIZE}`
  );
}

/** Thrown inside the read loop so `readCalendarOrSkip` can skip it. */
class CalendarRefusedError extends TransientError {
  constructor() {
    super(GRAPH_ACCESS_DENIED);
  }
}

/** GET one page: a 403 access-denied is a refusal, else the shared map. */
async function readPage(token: string, url: string): Promise<Json> {
  const res = await graphRequest('GET', url, token, undefined, {
    prefer: MICROSOFT_READ_PREFER,
  });
  if (isGraphAccessDenied(res)) throw new CalendarRefusedError();
  assertGraphOk(res, 'read');
  return toRecord(res.json);
}

/**
 * Every page from `firstUrl`, following `@odata.nextLink` verbatim (it
 * carries `$skiptoken`) — but only to Graph itself, so the token never goes
 * to another host. Capped at `MICROSOFT_READ_MAX_PAGES` (`truncated`).
 */
export async function readAllGraphPages(
  token: string,
  firstUrl: string,
): Promise<GraphPages> {
  const items: unknown[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; page < MICROSOFT_READ_MAX_PAGES && url; page += 1) {
    const json = await readPage(token, url);
    const value: unknown[] = Array.isArray(json.value) ? json.value : [];
    items.push(...value);
    url = nextLinkOf(json);
  }
  return { items, truncated: url !== null };
}

/**
 * One calendar's read: gone (404/410) → `'missing'` (the caller prunes it),
 * access denied → `'refused'` (skipped this run, never pruned); every other
 * error fails the whole fetch.
 */
export async function readCalendarOrSkip(
  work: Promise<GraphPages>,
): Promise<GraphPages | 'missing' | 'refused'> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof NotFoundError) return 'missing';
    if (err instanceof CalendarRefusedError) return 'refused';
    throw err;
  }
}

/** One `/me/calendars` row → a picker row (`isRaidLedger` set by the caller). */
export function toProviderCalendar(item: unknown): ProviderCalendar | null {
  const row = toRecord(item);
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '',
    primary: row.isDefaultCalendar === true,
    writable: row.canEdit === true,
    isRaidLedger: false,
  };
}

function nextLinkOf(json: Json): string | null {
  const next = json['@odata.nextLink'];
  if (typeof next !== 'string' || !next.startsWith(`${GRAPH_API}/`)) {
    return null;
  }
  return next;
}

function toRecord(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

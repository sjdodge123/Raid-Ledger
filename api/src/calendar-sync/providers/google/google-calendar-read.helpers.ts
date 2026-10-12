/**
 * ROK-1593 (spec ROK-669 §4.2 "Read", §6.4.1; plan D2–D5): Google Calendar
 * v3 reads behind the read capability — `calendarList` for the picker and
 * `events.list` for busy time. Hand-rolled over `googleJsonRequest`, called
 * through the namespace so specs can spy (same seam as the write helpers).
 *
 * Privacy (§6.4.1): the `fields` masks below are the ONLY fields requested,
 * and `normalizeGoogleEvent` copies nothing but instants, dates and our copy
 * id into a `BusyBlock`. Titles, locations and attendee e-mails never leave
 * this file. Nothing here logs; errors carry only a sanitised reason.
 *
 * Status map (read): as the write map (`assertWriteOk`), except a 403 that is
 * neither a scope nor a rate-limit reply means "this calendar is not readable
 * by us" → NotFoundError (the caller skips it, plan U9), and a rate limit
 * waits at least 60 s (plan D5).
 */
import * as googleHttp from './google-http';
import type { GoogleHttpResponse } from './google-http';
import {
  NotFoundError,
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import type {
  BusyBlock,
  ProviderCalendar,
  TimeRange,
} from '../calendar-provider.interface';
import { decodeCopyId, parseCopyId } from '../rl-copy-id.helpers';
import { assertWriteOk, GOOGLE_CALENDAR_API } from './google-write.helpers';

/** §6.4.1 — the exact `events.list` mask (Q-B/Q-C: `iCalUID` included). */
export const GOOGLE_EVENTS_FIELDS =
  'nextPageToken,items(status,start,end,transparency,eventType,iCalUID,extendedProperties/private,attendees(self,responseStatus))';
/** §6.4.1 — the exact `calendarList.list` mask (names shown, never stored). */
export const GOOGLE_CALENDAR_LIST_FIELDS =
  'nextPageToken,items(id,summary,primary,accessRole)';
export const GOOGLE_EVENTS_PAGE_SIZE = 2500;
/** Plan D4: stop following `nextPageToken` after this many pages. */
export const GOOGLE_READ_MAX_PAGES = 10;
/** Plan D3 + Q-B: never busy, whatever their transparency. */
export const DROPPED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'workingLocation',
  'focusTime',
  'birthday',
]);
/** Plan D5: a read rate limit never retries sooner than this. */
export const MIN_READ_RETRY_MS = 60_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

type Json = Record<string, unknown>;

/** `events.list` for one calendar, one page, the whole window. */
export function buildEventsListUrl(
  calendarId: string,
  range: TimeRange,
  pageToken?: string,
): string {
  const params = new URLSearchParams({
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    singleEvents: 'true',
    showDeleted: 'false',
    maxResults: String(GOOGLE_EVENTS_PAGE_SIZE),
    fields: GOOGLE_EVENTS_FIELDS,
  });
  if (pageToken) params.set('pageToken', pageToken);
  const id = encodeURIComponent(calendarId);
  return `${GOOGLE_CALENDAR_API}/calendars/${id}/events?${params.toString()}`;
}

/** `calendarList.list` — every calendar we can at least see busy time of. */
export function buildCalendarListUrl(pageToken?: string): string {
  const params = new URLSearchParams({
    minAccessRole: 'freeBusyReader',
    fields: GOOGLE_CALENDAR_LIST_FIELDS,
  });
  if (pageToken) params.set('pageToken', pageToken);
  return `${GOOGLE_CALENDAR_API}/users/me/calendarList?${params.toString()}`;
}

/** Throw the shared error class for a non-2xx read reply (see header). */
export function mapGoogleReadError(res: GoogleHttpResponse): void {
  try {
    assertWriteOk(res);
  } catch (err) {
    if (err instanceof RateLimitError) {
      const wait = Math.max(MIN_READ_RETRY_MS, err.retryAfterMs);
      throw new RateLimitError(wait, err.reason);
    }
    if (err instanceof ProviderAuthError && err.reason === 'http_403') {
      throw new NotFoundError('http_403');
    }
    throw err;
  }
}

/** GET + map; network failures and timeouts become TransientError. */
export async function googleReadGet(
  url: string,
  accessToken: string,
): Promise<Json> {
  let res: GoogleHttpResponse;
  try {
    res = await googleHttp.googleJsonRequest('GET', url, accessToken);
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new TransientError(timedOut ? 'timeout' : 'network');
  }
  mapGoogleReadError(res);
  return asRecord(res.json);
}

/** A page's items + its next token (absent → last page). */
export function readGooglePage(json: Json): {
  items: unknown[];
  nextPageToken: string | null;
} {
  const items = Array.isArray(json.items) ? (json.items as unknown[]) : [];
  const token = json.nextPageToken;
  return {
    items,
    nextPageToken: typeof token === 'string' && token ? token : null,
  };
}

/** True when a plan-D3 rule says the event is not busy. */
function isDropped(event: Json): boolean {
  if (event.status === 'cancelled') return true;
  if (event.transparency === 'transparent') return true;
  if (typeof event.eventType === 'string') {
    if (DROPPED_EVENT_TYPES.has(event.eventType)) return true;
  }
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  return attendees.some((a: unknown) => {
    const attendee = asRecord(a);
    return attendee.self === true && attendee.responseStatus === 'declined';
  });
}

/** `YYYY-MM-DD` that is a real calendar date → its UTC midnight, else null. */
function utcMidnight(date: unknown): number | null {
  if (typeof date !== 'string' || !DATE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

/** RFC 3339 with an explicit offset → epoch ms; floating times → null. */
function instant(dateTime: unknown): number | null {
  if (typeof dateTime !== 'string' || !DATE_TIME.test(dateTime)) return null;
  const ms = Date.parse(dateTime);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Start/end → block bounds. All-day: `end.date` is exclusive, so
 * `lastInclusive = end.date − 1 day`; dates are never tz-shifted (§4.6) and
 * the instants are their UTC midnights. Mixed or inverted bounds → null.
 */
function toBounds(start: Json, end: Json): BusyBlock | null {
  if (start.date !== undefined || end.date !== undefined) {
    const first = utcMidnight(start.date);
    const after = utcMidnight(end.date);
    if (first === null || after === null || after <= first) return null;
    const lastInclusive = new Date(after - DAY_MS).toISOString().slice(0, 10);
    const firstDate = new Date(first).toISOString().slice(0, 10);
    return {
      start: new Date(first),
      end: new Date(after),
      allDay: true,
      allDayDates: { first: firstDate, lastInclusive },
    };
  }
  const from = instant(start.dateTime);
  const to = instant(end.dateTime);
  if (from === null || to === null || to <= from) return null;
  return { start: new Date(from), end: new Date(to), allDay: false };
}

/**
 * One `events.list` item → a busy block, or null when a D3 rule drops it or
 * its times are unusable. Any instance's copy id is kept in `ourId`; a copy
 * written by `instanceId` (when given) is dropped here (R2). The adapter
 * passes null — the read interface carries no instance, so the runner (A5)
 * drops ours by `parseCopyId(block.ourId, instance)`.
 */
export function normalizeGoogleEvent(
  item: unknown,
  instanceId: string | null,
): BusyBlock | null {
  const event = asRecord(item);
  if (isDropped(event)) return null;
  const extended = asRecord(asRecord(event.extendedProperties).private);
  const copyId = extended.rlCopyId;
  if (instanceId && parseCopyId(copyId, instanceId)) return null;
  const block = toBounds(asRecord(event.start), asRecord(event.end));
  if (!block) return null;
  if (typeof copyId === 'string' && decodeCopyId(copyId)) block.ourId = copyId;
  return block;
}

/** One `calendarList` item → a picker row (`isRaidLedger` set by the caller). */
export function toProviderCalendar(item: unknown): ProviderCalendar | null {
  const row = asRecord(item);
  if (typeof row.id !== 'string' || !row.id) return null;
  return {
    id: row.id,
    name: typeof row.summary === 'string' ? row.summary : '',
    primary: row.primary === true,
    writable: row.accessRole === 'owner' || row.accessRole === 'writer',
    isRaidLedger: false,
  };
}

/** Every page of `url(pageToken)`, capped at `GOOGLE_READ_MAX_PAGES`. */
export async function readAllGooglePages(
  accessToken: string,
  url: (pageToken?: string) => string,
): Promise<{ items: unknown[]; truncated: boolean }> {
  const items: unknown[] = [];
  let token: string | undefined;
  for (let page = 0; page < GOOGLE_READ_MAX_PAGES; page += 1) {
    const next = readGooglePage(await googleReadGet(url(token), accessToken));
    items.push(...next.items);
    if (!next.nextPageToken) return { items, truncated: false };
    token = next.nextPageToken;
  }
  return { items, truncated: true };
}

function asRecord(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

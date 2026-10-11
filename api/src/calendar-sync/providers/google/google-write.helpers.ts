/**
 * ROK-1596 (spec ROK-669 §4.2 "Write", §5 "Our id"): Google Calendar v3
 * calls behind the write capability — the dedicated "Raid Ledger" calendar
 * and the per-sign-up copies. Hand-rolled over `googleJsonRequest`, called
 * through the namespace so specs can spy (same seam as the OAuth helpers).
 *
 * Status map (shared error classes; callers branch on the class):
 * 401 → ProviderAuthError · 403 insufficient scope → ProviderAuthError('scope')
 * · 403 rate-limit reasons / 429 → RateLimitError(Retry-After)
 * · 404 / 410 → NotFoundError · any other 4xx (400, 409, 422…) →
 * ProviderRequestError (permanent, no retry) · 5xx, network, timeout →
 * TransientError.
 * Nothing here logs, and no error carries a token or a response body: the
 * `reason` is `http_<status>`, `scope`, `network` or `timeout`.
 */
import * as googleHttp from './google-http';
import type { GoogleHttpResponse, GoogleJsonMethod } from './google-http';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import type { CopyEventInput, CopyRef } from '../calendar-provider.interface';

export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** Name of the dedicated calendar created under `calendar.app.created`. */
export const RAID_LEDGER_CALENDAR_SUMMARY = 'Raid Ledger';
/** Title prefix on tentative copies (spec §4.2; interface `tentative`). */
export const TENTATIVE_TITLE_PREFIX = '(Tentative) ';
/** `source.title` on every copy — the link back to the event page. */
export const COPY_SOURCE_TITLE = 'Raid Ledger';

/** The only keys a copy's request body may carry (privacy §6.4 spirit). */
export interface GoogleEventBody {
  summary: string;
  description: string;
  transparency: 'opaque' | 'transparent';
  start: { dateTime: string };
  end: { dateTime: string };
  extendedProperties: { private: { rlCopyId: string } };
  source: { title: string; url: string };
}

/** A calendar as `calendars.insert` / `calendars.get` report it. */
export interface GoogleCalendarInfo {
  id: string;
  summary: string | null;
}

/** Confirmed → Busy + plain title; tentative → Free + "(Tentative) ". */
export function buildGoogleEventBody(input: CopyEventInput): GoogleEventBody {
  return {
    summary: input.tentative
      ? `${TENTATIVE_TITLE_PREFIX}${input.title}`
      : input.title,
    description: input.description,
    transparency: input.tentative ? 'transparent' : 'opaque',
    start: { dateTime: input.start.toISOString() },
    end: { dateTime: input.end.toISOString() },
    extendedProperties: { private: { rlCopyId: input.copyId } },
    source: { title: COPY_SOURCE_TITLE, url: input.url },
  };
}

/** `calendars.insert({summary:'Raid Ledger'})` → the new calendar. */
export async function insertGoogleCalendar(
  accessToken: string,
): Promise<GoogleCalendarInfo> {
  const res = await call('POST', calendarsUrl(), accessToken, {
    summary: RAID_LEDGER_CALENDAR_SUMMARY,
  });
  return readCalendar(res.json);
}

/** `calendars.get` — NotFoundError when the calendar is gone. */
export async function getGoogleCalendar(
  accessToken: string,
  calendarId: string,
): Promise<GoogleCalendarInfo> {
  const res = await call('GET', calendarsUrl(calendarId), accessToken);
  return readCalendar(res.json);
}

/** `calendars.delete` — NotFoundError when it is already gone. */
export async function deleteGoogleCalendar(
  accessToken: string,
  calendarId: string,
): Promise<void> {
  await call('DELETE', calendarsUrl(calendarId), accessToken);
}

/** `events.insert` of a copy → its ref. */
export async function insertGoogleEvent(
  accessToken: string,
  calendarId: string,
  input: CopyEventInput,
): Promise<CopyRef> {
  const url = eventsUrl(calendarId);
  const res = await call('POST', url, accessToken, buildGoogleEventBody(input));
  return readCopyRef(res.json, calendarId);
}

/** `events.patch` of an existing copy (same id) → its new ref. */
export async function patchGoogleEvent(
  accessToken: string,
  calendarId: string,
  providerEventId: string,
  input: CopyEventInput,
): Promise<CopyRef> {
  const url = eventsUrl(calendarId, providerEventId);
  const res = await call(
    'PATCH',
    url,
    accessToken,
    buildGoogleEventBody(input),
  );
  return readCopyRef(res.json, calendarId);
}

/** `events.delete` — NotFoundError on 404/410 (the adapter treats as ok). */
export async function deleteGoogleEvent(
  accessToken: string,
  calendarId: string,
  providerEventId: string,
): Promise<void> {
  await call('DELETE', eventsUrl(calendarId, providerEventId), accessToken);
}

function calendarsUrl(calendarId?: string): string {
  const base = `${GOOGLE_CALENDAR_API}/calendars`;
  return calendarId ? `${base}/${encodeURIComponent(calendarId)}` : base;
}

function eventsUrl(calendarId: string, providerEventId?: string): string {
  const base = `${calendarsUrl(calendarId)}/events`;
  return providerEventId
    ? `${base}/${encodeURIComponent(providerEventId)}`
    : base;
}

async function call(
  method: GoogleJsonMethod,
  url: string,
  accessToken: string,
  body?: unknown,
): Promise<GoogleHttpResponse> {
  let res: GoogleHttpResponse;
  try {
    res = await googleHttp.googleJsonRequest(method, url, accessToken, body);
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new TransientError(timedOut ? 'timeout' : 'network');
  }
  assertWriteOk(res);
  return res;
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);
const SCOPE_REASONS = new Set([
  'insufficientPermissions',
  'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
]);

/** Throw the shared error class for a non-2xx Google reply. */
export function assertWriteOk(res: GoogleHttpResponse): void {
  const { status } = res;
  if (status >= 200 && status < 300) return;
  const reason = `http_${status}`;
  const reasons = googleErrorReasons(res.json);
  const rateLimited = reasons.some((r) => RATE_LIMIT_REASONS.has(r));
  if (status === 429 || (status === 403 && rateLimited)) {
    throw new RateLimitError(
      googleHttp.parseRetryAfterMs(res.retryAfter),
      reason,
    );
  }
  if (status === 401) throw new ProviderAuthError(reason);
  if (status === 403) {
    const scope = reasons.some((r) => SCOPE_REASONS.has(r));
    throw new ProviderAuthError(scope ? 'scope' : reason);
  }
  if (status === 404 || status === 410) throw new NotFoundError(reason);
  if (status >= 400 && status < 500) throw new ProviderRequestError(reason);
  throw new TransientError(reason);
}

/** `error.errors[].reason` + `error.details[].reason`; never the message. */
function googleErrorReasons(json: unknown): string[] {
  const error = asRecord(asRecord(json).error);
  const items = [error.errors, error.details].flatMap((list) =>
    Array.isArray(list) ? (list as unknown[]) : [],
  );
  return items
    .map((item) => asRecord(item).reason)
    .filter((r): r is string => typeof r === 'string');
}

function readCalendar(json: unknown): GoogleCalendarInfo {
  const { id, summary } = asRecord(json);
  if (typeof id !== 'string' || !id) {
    throw new TransientError('malformed_response');
  }
  return { id, summary: typeof summary === 'string' ? summary : null };
}

function readCopyRef(json: unknown, calendarId: string): CopyRef {
  const { id, etag } = asRecord(json);
  if (typeof id !== 'string' || !id) {
    throw new TransientError('malformed_response');
  }
  const ref: CopyRef = { calendarId, providerEventId: id };
  if (typeof etag === 'string' && etag) ref.etag = etag;
  return ref;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

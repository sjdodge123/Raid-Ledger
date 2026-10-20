/**
 * ROK-1598 (spec §2.3, §2.9): the iCloud CalDAV client — discovery,
 * collection listing, calendar-query, and conditional PUT / DELETE.
 *
 * Every call goes through `request`, which follows 301/302/307/308 itself
 * (max `MAX_REDIRECT_HOPS`) and only to an allowlisted iCloud host (D2): a
 * hop anywhere else fails with `TransientError('redirect_refused')` before
 * the credentials are sent. Statuses map per `mapCalDavStatus`; 412 is
 * handed back so the write path can branch on it (D6). Error reasons are
 * fixed codes — no URL, header or body ever reaches a message.
 */
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import { parseRetryAfterMs } from '../google/google-http';
import * as appleHttp from './apple-caldav-http';
import type {
  CalDavAuth,
  CalDavHttpRequest,
  CalDavHttpResponse,
} from './apple-caldav-http';
import {
  PROPFIND_COLLECTIONS,
  PROPFIND_ETAG,
  PROPFIND_HOME_SET,
  PROPFIND_PRINCIPAL,
  calendarQueryBody,
  firstEtag,
  homeSetHref,
  mkcalendarBody,
  parseMultiStatus,
  principalHref,
  toCalendarObjects,
  toCollections,
  type CalDavCollection,
  type CalDavObject,
  type HrefSkips,
  type MultiStatus,
} from './apple-caldav-xml.helpers';

export const MAX_REDIRECT_HOPS = 3;
const REDIRECTS = new Set([301, 302, 307, 308]);

/** `discovery` turns a 403 into an auth failure; elsewhere it is a refusal. */
export type CalDavContext = 'discovery' | 'data';

/** A mapped response plus the URL that finally answered (after redirects). */
export interface CalDavResult extends CalDavHttpResponse {
  url: string;
}

export interface CalDavDiscovery {
  principalUrl: string;
  homeSetUrl: string;
}

export interface CalDavRange {
  start: Date;
  end: Date;
}

export interface PutConditions {
  ifMatch?: string;
  ifNoneMatch?: '*';
}

export type PutResult =
  { status: 'ok'; etag: string | null } | { status: 'precondition_failed' };

export type DeleteResult = { status: 'ok' } | { status: 'precondition_failed' };

/**
 * §2.3 status table. Returns `res` for 2xx and 412; throws otherwise:
 * 401 → auth; 403 → auth on discovery, request refusal elsewhere (a
 * read-only shared calendar must not flip the connection to reconnect);
 * 404/410 → not found; 429 or 503 + Retry-After → rate limit; other 5xx →
 * transient; any other status → request refusal.
 */
export function mapCalDavStatus<T extends CalDavHttpResponse>(
  res: T,
  ctx: CalDavContext = 'data',
): T {
  const s = res.status;
  if ((s >= 200 && s < 300) || s === 412) return res;
  if (s === 401) throw new ProviderAuthError('caldav_401');
  if (s === 403) {
    throw ctx === 'discovery'
      ? new ProviderAuthError('caldav_403')
      : new ProviderRequestError('caldav_403');
  }
  if (s === 404 || s === 410) throw new NotFoundError(`http_${s}`);
  if (s === 429 || (s === 503 && res.retryAfter)) {
    throw new RateLimitError(parseRetryAfterMs(res.retryAfter), `http_${s}`);
  }
  if (s >= 500) throw new TransientError(`http_${s}`);
  throw new ProviderRequestError(`http_${s}`);
}

/** Send `req`, following allowlisted redirects, then map the status. */
export async function request(
  req: CalDavHttpRequest,
  ctx: CalDavContext = 'data',
): Promise<CalDavResult> {
  if (!appleHttp.isAllowedCalDavUrl(req.url)) {
    throw new TransientError('url_refused');
  }
  let current = req;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const res = await send(current);
    if (!REDIRECTS.has(res.status)) {
      return mapCalDavStatus({ ...res, url: current.url }, ctx);
    }
    current = { ...current, url: nextHop(res.location, current.url) };
  }
  throw new TransientError('redirect_loop');
}

async function send(req: CalDavHttpRequest): Promise<CalDavHttpResponse> {
  try {
    return await appleHttp.caldavFetch(req);
  } catch {
    throw new TransientError('network');
  }
}

function nextHop(location: string | null, from: string): string {
  const next = location ? safeResolve(location, from) : null;
  if (!next || !appleHttp.isAllowedCalDavUrl(next)) {
    throw new TransientError('redirect_refused');
  }
  return next;
}

function safeResolve(location: string, from: string): string | null {
  try {
    return new URL(location, from).href;
  } catch {
    return null;
  }
}

async function propfind(
  auth: CalDavAuth,
  url: string,
  depth: '0' | '1',
  body: string,
  ctx: CalDavContext = 'data',
): Promise<{ ms: MultiStatus; url: string }> {
  const res = await request(
    { method: 'PROPFIND', url, auth, depth, body },
    ctx,
  );
  return { ms: parseMultiStatus(res.text), url: res.url };
}

/**
 * Principal → calendar home set, starting at `APPLE_CALDAV_BASE`. iCloud
 * answers with its partition host (`pNN-caldav.icloud.com`) either as a
 * redirect or as an absolute href; both are accepted. No principal or home
 * set → `ProviderAuthError('caldav_no_principal')`.
 */
export async function discover(auth: CalDavAuth): Promise<CalDavDiscovery> {
  const base = appleHttp.APPLE_CALDAV_BASE;
  const p = await propfind(auth, base, '0', PROPFIND_PRINCIPAL, 'discovery');
  const principal = principalHref(p.ms, p.url);
  if (!principal) throw new ProviderAuthError('caldav_no_principal');
  const h = await propfind(
    auth,
    principal,
    '0',
    PROPFIND_HOME_SET,
    'discovery',
  );
  const homeSetUrl = homeSetHref(h.ms, h.url);
  if (!homeSetUrl) throw new ProviderAuthError('caldav_no_principal');
  return { principalUrl: h.url, homeSetUrl };
}

/** D9: the VEVENT calendars under the home set (one Depth-1 PROPFIND). */
export async function listCollections(
  auth: CalDavAuth,
  homeSetUrl: string,
  skips?: HrefSkips,
): Promise<CalDavCollection[]> {
  const r = await propfind(auth, homeSetUrl, '1', PROPFIND_COLLECTIONS);
  return toCollections(r.ms, r.url, skips);
}

/** REPORT calendar-query: raw objects overlapping `range` (no expansion). */
export async function queryEvents(
  auth: CalDavAuth,
  collectionUrl: string,
  range: CalDavRange,
  skips?: HrefSkips,
): Promise<CalDavObject[]> {
  const res = await request({
    method: 'REPORT',
    url: collectionUrl,
    auth,
    depth: '1',
    body: calendarQueryBody(range),
  });
  return toCalendarObjects(parseMultiStatus(res.text), res.url, skips);
}

/** Depth-0 `getetag` of one object (null when the server sends none). */
export async function getEtag(
  auth: CalDavAuth,
  url: string,
): Promise<string | null> {
  const r = await propfind(auth, url, '0', PROPFIND_ETAG);
  return firstEtag(r.ms);
}

/** Create a VEVENT calendar at `url` (an existing one → 405 refusal). */
export async function mkcalendar(
  auth: CalDavAuth,
  url: string,
  displayName: string,
): Promise<void> {
  await request({
    method: 'MKCALENDAR',
    url,
    auth,
    body: mkcalendarBody(displayName),
  });
}

/** D6: conditional PUT; 412 → `precondition_failed` for the caller. */
export async function putObject(
  auth: CalDavAuth,
  url: string,
  ics: string,
  cond: PutConditions = {},
): Promise<PutResult> {
  const res = await request({
    method: 'PUT',
    url,
    auth,
    body: ics,
    ...(cond.ifMatch ? { ifMatch: cond.ifMatch } : {}),
    ...(cond.ifNoneMatch ? { ifNoneMatch: cond.ifNoneMatch } : {}),
  });
  if (res.status === 412) return { status: 'precondition_failed' };
  return { status: 'ok', etag: res.etag };
}

/** DELETE (optionally `If-Match`); a missing object throws `NotFoundError`. */
export async function deleteObject(
  auth: CalDavAuth,
  url: string,
  ifMatch?: string,
): Promise<DeleteResult> {
  const res = await request({
    method: 'DELETE',
    url,
    auth,
    ...(ifMatch ? { ifMatch } : {}),
  });
  return res.status === 412
    ? { status: 'precondition_failed' }
    : { status: 'ok' };
}

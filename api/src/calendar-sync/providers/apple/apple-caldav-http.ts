/**
 * ROK-1598 (spec §2.1, D2): the one HTTP seam for iCloud CalDAV.
 *
 * Callers import this module as a namespace (`import * as appleHttp`) so a
 * spec can `jest.spyOn(appleHttp, 'caldavFetch')` and intercept it in a unit
 * spec AND in the singleton integration app (the `google-http.ts` pattern).
 *
 * One hop only: `redirect: 'manual'` hands every 3xx back to the client,
 * which follows it only to an allowlisted iCloud host — auto-follow would
 * either drop `Authorization` (cross-origin) or leak it to a hostile target.
 * Network and abort failures propagate as the fetch rejection; the client
 * maps them. Nothing here logs: headers carry the app-specific password and
 * bodies carry calendar data.
 */

/** Discovery entry point — a constant, never user input (SSRF guard). */
export const APPLE_CALDAV_BASE = 'https://caldav.icloud.com/';

/** Per-request timeout for every CalDAV call. */
export const CALDAV_HTTP_TIMEOUT_MS = 15_000;

/** `caldav.icloud.com` and its partitions (`p07-caldav.icloud.com`). */
export const ICLOUD_CALDAV_HOST = /^(p\d{1,3}-)?caldav\.icloud\.com$/;

export type CalDavMethod =
  'PROPFIND' | 'REPORT' | 'MKCALENDAR' | 'PUT' | 'DELETE' | 'GET';

/** Basic-auth login; `CalDavCredentials` satisfies it structurally. */
export interface CalDavAuth {
  username: string;
  appPassword: string;
}

export interface CalDavHttpRequest {
  method: CalDavMethod;
  url: string;
  auth: CalDavAuth;
  depth?: '0' | '1';
  body?: string;
  /** Defaults: `text/calendar` for PUT, `application/xml` otherwise. */
  contentType?: string;
  ifMatch?: string;
  ifNoneMatch?: '*';
}

/** What callers see of a CalDAV response — no request echo. */
export interface CalDavHttpResponse {
  status: number;
  text: string;
  etag: string | null;
  location: string | null;
  retryAfter: string | null;
}

/** True only for an `https:` URL on an iCloud CalDAV host, default port. */
export function isAllowedCalDavUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' &&
      ICLOUD_CALDAV_HOST.test(u.hostname) &&
      u.port === '' &&
      u.username === '' &&
      u.password === ''
    );
  } catch {
    return false;
  }
}

/** Send one CalDAV request; 3xx come back unfollowed. */
export async function caldavFetch(
  req: CalDavHttpRequest,
): Promise<CalDavHttpResponse> {
  const res = await fetch(req.url, {
    method: req.method,
    headers: buildHeaders(req),
    redirect: 'manual',
    ...(req.body === undefined ? {} : { body: req.body }),
    signal: AbortSignal.timeout(CALDAV_HTTP_TIMEOUT_MS),
  });
  const h = res.headers;
  return {
    status: res.status,
    text: await res.text(),
    etag: h.get('etag'),
    location: h.get('location'),
    retryAfter: h.get('retry-after'),
  };
}

function buildHeaders(req: CalDavHttpRequest): Record<string, string> {
  const login = `${req.auth.username}:${req.auth.appPassword}`;
  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(login, 'utf8').toString('base64')}`,
  };
  if (req.depth) headers.Depth = req.depth;
  if (req.body !== undefined) {
    headers['Content-Type'] = req.contentType ?? defaultType(req.method);
  }
  if (req.ifMatch) headers['If-Match'] = req.ifMatch;
  if (req.ifNoneMatch) headers['If-None-Match'] = req.ifNoneMatch;
  if (req.method === 'PROPFIND' || req.method === 'REPORT') {
    headers.Prefer = 'return=minimal';
  }
  return headers;
}

function defaultType(method: CalDavMethod): string {
  return method === 'PUT'
    ? 'text/calendar; charset=utf-8'
    : 'application/xml; charset=utf-8';
}

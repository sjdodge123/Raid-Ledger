/**
 * ROK-1598 L1 (spec §4.1): an in-process iCloud CalDAV server behind the
 * `caldavFetch` seam, for unit, conformance and integration specs.
 *
 * Install:
 *   const server = new FakeCalDavServer();
 *   jest.spyOn(appleHttp, 'caldavFetch').mockImplementation(server.handle);
 *
 * Model: `caldav.icloud.com` answers every path with a 301 to the same path
 * on `p07-caldav.icloud.com`; `/` → principal `/1234567/principal/` (relative
 * href); the principal → the home set as an absolute `:443` href; the home
 * set lists `home` (VEVENT, writable — the primary), `reminders` (VTODO),
 * `shared-ro` (VEVENT, read-only), plus a non-calendar `inbox`. Wrong Basic
 * credentials → 401. REPORT filters by the body's time-range on the first
 * DTSTART/DTEND (an RRULE master is returned whole when it starts before the
 * range end, as iCloud does). PUT/DELETE honour `If-Match` and
 * `If-None-Match: *` (412), and every write bumps the object etag and the
 * collection ctag. MKCALENDAR on an existing id → 405; DELETE on a
 * collection drops it. Unknown → 404.
 *
 * Hooks: `failNext`, `redirectTo` (one hostile/other redirect), `seedEvent`,
 * `seedIcs`, `addCalendar`, `removeCalendar`, `editObject` (a user edit),
 * `object`, `ctag`, `collectionUrl`, `putReturnsEtag`, and `requests` (the
 * log; the password is never kept, only `hadAuth`).
 */
import type {
  CalDavAuth,
  CalDavHttpRequest,
  CalDavHttpResponse,
} from './apple-caldav-http';
import {
  decodeXmlText,
  escapeXml,
  toIcalUtc,
} from './apple-caldav-xml.helpers';

/** The login the fake accepts by default. Test values only. */
export const FAKE_CALDAV_CREDENTIALS: CalDavAuth = {
  username: 'raider@icloud.example',
  appPassword: 'abcd-efgh-ijkl-mnop',
};
export const FAKE_PARTITION_ORIGIN = 'https://p07-caldav.icloud.com';
const DSID = '1234567';
const HOME_PATH = `/${DSID}/calendars/`;
const PRINCIPAL_PATH = `/${DSID}/principal/`;
export const FAKE_PRINCIPAL_URL = `${FAKE_PARTITION_ORIGIN}${PRINCIPAL_PATH}`;
export const FAKE_HOME_SET_URL = `${FAKE_PARTITION_ORIGIN}${HOME_PATH}`;

/** `network` makes the seam reject, like a DNS failure or the timeout. */
export type FakeCalDavFailure = 'auth' | 'rate' | 'transient' | 'network';

export interface FakeCalendarOptions {
  displayName?: string;
  components?: string[];
  writable?: boolean;
}

/** One request as the fake saw it. */
export interface FakeSeenRequest {
  method: CalDavHttpRequest['method'];
  url: string;
  host: string;
  depth: string | null;
  ifMatch: string | null;
  ifNoneMatch: string | null;
  hadAuth: boolean;
  body: string | null;
}

type FakeObject = { ics: string; etag: string };

type FakeCalendar = Required<FakeCalendarOptions> & {
  ctag: number;
  objects: Map<string, FakeObject>;
};

const NO_HEADERS = { etag: null, location: null, retryAfter: null };
const reply = (
  status: number,
  text = '',
  extra: Partial<CalDavHttpResponse> = {},
): CalDavHttpResponse => ({ ...NO_HEADERS, status, text, ...extra });

const MS_OPEN =
  '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"' +
  ' xmlns:cs="http://calendarserver.org/ns/">';
const multistatus = (rows: string[]) =>
  reply(207, `<?xml version="1.0"?>${MS_OPEN}${rows.join('')}</d:multistatus>`);
const entry = (href: string, props: string) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}` +
  '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';

export class FakeCalDavServer {
  readonly requests: FakeSeenRequest[] = [];
  /** Set false to answer PUT with no `ETag` header (the D6 fallback). */
  putReturnsEtag = true;
  private readonly calendars = new Map<string, FakeCalendar>();
  private readonly failures: FakeCalDavFailure[] = [];
  private redirect: string | null = null;
  private seq = 0;

  constructor(private readonly login: CalDavAuth = FAKE_CALDAV_CREDENTIALS) {
    this.addCalendar('home', { displayName: 'Home' });
    this.addCalendar('reminders', { components: ['VTODO'] });
    this.addCalendar('shared-ro', { displayName: 'Shared', writable: false });
  }

  addCalendar(id: string, o: FakeCalendarOptions = {}): void {
    this.calendars.set(id, {
      displayName: o.displayName ?? id,
      components: o.components ?? ['VEVENT'],
      writable: o.writable ?? true,
      ctag: 1,
      objects: new Map(),
    });
  }

  /** Drop a calendar and its objects, as if the user deleted it. */
  removeCalendar(id: string): void {
    this.calendars.delete(id);
  }

  /** The next request answers this instead (queued, one per call). */
  failNext(kind: FakeCalDavFailure): void {
    this.failures.push(kind);
  }

  /** The next request answers `301 Location: url`. */
  redirectTo(url: string): void {
    this.redirect = url;
  }

  collectionUrl(calendarId: string): string {
    return `${FAKE_HOME_SET_URL}${calendarId}/`;
  }

  /** Store a raw VCALENDAR; returns the object's absolute URL. */
  seedIcs(calendarId: string, ics: string, name?: string): string {
    const file = name ?? `seed-${++this.seq}.ics`;
    this.store(this.mustCalendar(calendarId), file, ics);
    return `${this.collectionUrl(calendarId)}${file}`;
  }

  /** A foreign single event; `busy: false` → `TRANSP:TRANSPARENT`. */
  seedEvent(
    calendarId: string,
    e: { start: Date; end: Date; busy: boolean },
  ): string {
    const uid = `foreign-${++this.seq}@icloud.example`;
    return this.seedIcs(calendarId, eventIcs(uid, e));
  }

  /** Simulate the user editing an object in Apple Calendar. */
  editObject(url: string): void {
    const hit = this.locate(url);
    const obj = hit?.cal.objects.get(hit.name);
    if (!hit || !obj) throw new Error(`FakeCalDavServer: no object ${url}`);
    this.store(hit.cal, hit.name, obj.ics);
  }

  object(url: string): FakeObject | null {
    const hit = this.locate(url);
    return hit?.cal.objects.get(hit.name) ?? null;
  }

  ctag(calendarId: string): string | null {
    const cal = this.calendars.get(calendarId);
    return cal ? String(cal.ctag) : null;
  }

  readonly handle = (req: CalDavHttpRequest): Promise<CalDavHttpResponse> =>
    new Promise((resolve) => resolve(this.route(req)));

  private route(req: CalDavHttpRequest): CalDavHttpResponse {
    const url = new URL(req.url);
    this.record(req, url);
    const early = this.takeOverride();
    if (early) return early;
    const { username, appPassword } = req.auth;
    if (
      username !== this.login.username ||
      appPassword !== this.login.appPassword
    ) {
      return reply(401);
    }
    if (url.hostname === 'caldav.icloud.com') {
      return reply(301, '', {
        location: `${FAKE_PARTITION_ORIGIN}${url.pathname}`,
      });
    }
    if (url.origin !== FAKE_PARTITION_ORIGIN) return reply(404);
    return this.routePath(req, url.pathname);
  }

  private record(req: CalDavHttpRequest, url: URL): void {
    this.requests.push({
      method: req.method,
      url: req.url,
      host: url.hostname,
      depth: req.depth ?? null,
      ifMatch: req.ifMatch ?? null,
      ifNoneMatch: req.ifNoneMatch ?? null,
      hadAuth: req.auth.username !== '' && req.auth.appPassword !== '',
      body: req.body ?? null,
    });
  }

  private takeOverride(): CalDavHttpResponse | null {
    const location = this.redirect;
    if (location) {
      this.redirect = null;
      return reply(301, '', { location });
    }
    const kind = this.failures.shift();
    if (kind === 'network') throw new TypeError('fetch failed');
    if (kind === 'auth') return reply(401);
    if (kind === 'rate') return reply(429, '', { retryAfter: '30' });
    if (kind === 'transient') return reply(503);
    return null;
  }

  private routePath(req: CalDavHttpRequest, path: string): CalDavHttpResponse {
    if (path === '/') {
      const p = `<d:current-user-principal><d:href>${PRINCIPAL_PATH}</d:href></d:current-user-principal>`;
      return multistatus([entry('/', p)]);
    }
    if (path === PRINCIPAL_PATH) {
      const home = `https://p07-caldav.icloud.com:443${HOME_PATH}`;
      const p = `<c:calendar-home-set><d:href>${home}</d:href></c:calendar-home-set>`;
      return multistatus([entry(path, p)]);
    }
    if (path === HOME_PATH) return this.listing();
    const m = /^\/1234567\/calendars\/([^/]+)\/([^/]*)$/.exec(path);
    if (!m?.[1]) return reply(404);
    return m[2]
      ? this.routeObject(req, m[1], m[2])
      : this.routeCollection(req, m[1]);
  }

  private listing(): CalDavHttpResponse {
    const rows = [
      entry(HOME_PATH, '<d:resourcetype><d:collection/></d:resourcetype>'),
      entry(
        `${HOME_PATH}inbox/`,
        '<d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype>',
      ),
    ];
    for (const [id, cal] of this.calendars) {
      rows.push(entry(`${HOME_PATH}${id}/`, calendarProps(cal)));
    }
    return multistatus(rows);
  }

  private routeCollection(req: CalDavHttpRequest, id: string) {
    const cal = this.calendars.get(id);
    if (req.method === 'MKCALENDAR') {
      if (cal) return reply(405);
      const name = /<d:displayname>([^<]*)<\/d:displayname>/.exec(
        req.body ?? '',
      );
      this.addCalendar(id, { displayName: decodeXmlText(name?.[1] ?? id) });
      return reply(201);
    }
    if (!cal) return reply(404);
    if (req.method === 'DELETE') {
      this.calendars.delete(id);
      return reply(204);
    }
    if (req.method === 'REPORT') return this.query(cal, id, req.body ?? '');
    return multistatus([
      entry(`${HOME_PATH}${id}/`, `<cs:getctag>${cal.ctag}</cs:getctag>`),
    ]);
  }

  private query(cal: FakeCalendar, id: string, body: string) {
    const m = /start="(\d{8}T\d{6}Z)" end="(\d{8}T\d{6}Z)"/.exec(body);
    const from = icsStamp(m?.[1] ?? '')?.at ?? -Infinity;
    const to = icsStamp(m?.[2] ?? '')?.at ?? Infinity;
    const rows: string[] = [];
    for (const [name, obj] of cal.objects) {
      if (!overlaps(obj.ics, from, to)) continue;
      const props = `<d:getetag>${escapeXml(obj.etag)}</d:getetag><c:calendar-data>${escapeXml(obj.ics)}</c:calendar-data>`;
      rows.push(entry(`${HOME_PATH}${id}/${name}`, props));
    }
    return multistatus(rows);
  }

  private routeObject(req: CalDavHttpRequest, id: string, name: string) {
    const cal = this.calendars.get(id);
    if (!cal) return reply(404);
    const obj = cal.objects.get(name);
    if (req.method === 'PUT') return this.put(cal, name, req);
    if (!obj) return reply(404);
    if (req.method === 'DELETE') {
      if (req.ifMatch !== undefined && req.ifMatch !== obj.etag)
        return reply(412);
      cal.objects.delete(name);
      cal.ctag++;
      return reply(204);
    }
    const props = `<d:getetag>${escapeXml(obj.etag)}</d:getetag>`;
    return multistatus([entry(`${HOME_PATH}${id}/${name}`, props)]);
  }

  private put(cal: FakeCalendar, name: string, req: CalDavHttpRequest) {
    if (!cal.writable) return reply(403);
    const existing = cal.objects.get(name);
    if (req.ifNoneMatch === '*' && existing) return reply(412);
    if (req.ifMatch !== undefined && existing?.etag !== req.ifMatch) {
      return reply(412);
    }
    const etag = this.store(cal, name, req.body ?? '');
    return reply(existing ? 204 : 201, '', this.putReturnsEtag ? { etag } : {});
  }

  private store(cal: FakeCalendar, name: string, ics: string): string {
    const etag = `"e${++this.seq}"`;
    cal.objects.set(name, { ics, etag });
    cal.ctag++;
    return etag;
  }

  private mustCalendar(id: string): FakeCalendar {
    const cal = this.calendars.get(id);
    if (!cal) throw new Error(`FakeCalDavServer: no calendar ${id}`);
    return cal;
  }

  private locate(url: string): { cal: FakeCalendar; name: string } | null {
    const m = /^\/1234567\/calendars\/([^/]+)\/([^/]+)$/.exec(
      new URL(url).pathname,
    );
    const cal = m?.[1] ? this.calendars.get(m[1]) : undefined;
    return cal && m?.[2] ? { cal, name: m[2] } : null;
  }
}

function calendarProps(cal: FakeCalendar): string {
  const comps = cal.components.map((c) => `<c:comp name="${c}"/>`).join('');
  const read = '<d:privilege><d:read/></d:privilege>';
  const write = cal.writable ? '<d:privilege><d:write/></d:privilege>' : '';
  return (
    '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>' +
    `<d:displayname>${escapeXml(cal.displayName)}</d:displayname>` +
    `<c:supported-calendar-component-set>${comps}</c:supported-calendar-component-set>` +
    `<cs:getctag>${cal.ctag}</cs:getctag>` +
    `<d:current-user-privilege-set>${read}${write}</d:current-user-privilege-set>`
  );
}

function eventIcs(uid: string, e: { start: Date; end: Date; busy: boolean }) {
  const transp = e.busy ? 'OPAQUE' : 'TRANSPARENT';
  const lines = `BEGIN:VCALENDAR|VERSION:2.0|PRODID:-//FakeCalDav//EN|BEGIN:VEVENT|UID:${uid}|DTSTART:${toIcalUtc(e.start)}|DTEND:${toIcalUtc(e.end)}|TRANSP:${transp}|END:VEVENT|END:VCALENDAR|`;
  return lines.split('|').join('\r\n');
}

/** `YYYYMMDD[THHMMSS[Z]]` → epoch ms (treated as UTC — a fake). */
function icsStamp(raw: string): { at: number; dateOnly: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(raw);
  if (!m) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  const at = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));
  return { at, dateOnly: m[4] === undefined };
}

function icsProp(ics: string, prop: string) {
  const m = new RegExp(`^${prop}(?:;[^:\\r\\n]*)?:([0-9TZ]+)`, 'm').exec(ics);
  return m?.[1] ? icsStamp(m[1]) : null;
}

function overlaps(ics: string, from: number, to: number): boolean {
  const start = icsProp(ics, 'DTSTART');
  if (!start) return false;
  if (/^RRULE:/m.test(ics)) return start.at < to;
  const end =
    icsProp(ics, 'DTEND')?.at ?? start.at + (start.dateOnly ? 86_400_000 : 0);
  return start.at < to && end > from;
}

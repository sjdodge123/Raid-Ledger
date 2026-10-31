/**
 * ROK-1597 (spec §6): an in-memory Microsoft Graph behind the
 * `microsoftJsonRequest` seam — the READ half (lane 7a-2): `/me`,
 * `/me/calendars` and `calendarView` with `@odata.nextLink` paging
 * (`pageSize` forces 2+ pages) — and the WRITE half (lane 7b-1): calendar
 * create (409 `ErrorFolderExists` on a duplicate name) / get / delete /
 * `$filter=name eq`, event create / PATCH / DELETE and the
 * extended-property `$filter` adopt lookup. Events are stored in
 * Graph's own shape (`start.dateTime` zone-less + `timeZone: 'UTC'`).
 * Install with
 * `jest.spyOn(microsoftHttp, 'microsoftJsonRequest').mockImplementation(api.handle)`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type {
  MicrosoftHttpResponse,
  MicrosoftJsonMethod,
  MicrosoftJsonOptions,
} from './microsoft-http';
import { GRAPH_API, MS_ME_URL } from './microsoft-graph.constants';

type Json = Record<string, unknown>;
export const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as unknown;
const reply = (
  status: number,
  json: unknown,
  retryAfter: string | null = null,
): MicrosoftHttpResponse => ({ status, json, retryAfter });

/** The default calendar's id (Graph ids are base64url-ish, `=` included). */
export const FAKE_DEFAULT_CALENDAR_ID = 'AAMkADfake-default_cal=';

/** A request as the fake saw it (the token is kept for assertions only). */
export interface GraphSeenRequest {
  method: MicrosoftJsonMethod;
  url: string;
  accessToken: string;
  body: unknown;
  prefer: readonly string[];
}

export interface FakeGraphCalendar {
  name: string;
  canEdit: boolean;
  isDefaultCalendar: boolean;
  /** eventId → event JSON in Graph's shape. */
  events: Map<string, Json>;
}

export type FakeGraphFailure = 'auth' | 'rate' | 'transient' | 'denied';

/** Graph `dateTimeTimeZone` for an instant, as Graph sends it under UTC. */
export function graphDateTime(d: Date): { dateTime: string; timeZone: 'UTC' } {
  return {
    dateTime: `${d.toISOString().slice(0, 19)}.0000000`,
    timeZone: 'UTC',
  };
}

export class FakeGraphCalendarApi {
  readonly calendars = new Map<string, FakeGraphCalendar>([
    [FAKE_DEFAULT_CALENDAR_ID, newCalendar('Calendar', true, true)],
  ]);
  readonly requests: GraphSeenRequest[] = [];
  /** Items per page on every list (set low to force `@odata.nextLink`). */
  pageSize = 250;
  /** Item 4: `calendarView` drops `$expand` (no property array at all). */
  ignoreViewExpand = false;
  private seq = 0;
  private readonly failures: MicrosoftHttpResponse[] = [];

  /** The next request answers this instead. */
  failNext(kind: FakeGraphFailure): void {
    const byKind: Record<FakeGraphFailure, () => MicrosoftHttpResponse> = {
      auth: () => reply(401, fixture('error-401')),
      rate: () => reply(429, fixture('error-429'), '2'),
      transient: () => reply(503, { error: { code: 'ServiceNotAvailable' } }),
      denied: () => reply(403, fixture('error-403')),
    };
    this.failures.push(byKind[kind]());
  }

  /** Another calendar (shared / secondary). */
  addCalendar(id: string, name: string, canEdit = true): void {
    this.calendars.set(id, newCalendar(name, canEdit, false));
  }

  /** A foreign (not Raid Ledger) timed event; `busy: false` → `showAs: free`. */
  seedEvent(calendarId: string, e: { start: Date; end: Date; busy: boolean }) {
    this.seedRaw(calendarId, {
      showAs: e.busy ? 'busy' : 'free',
      isAllDay: false,
      isCancelled: false,
      responseStatus: { response: 'organizer' },
      start: graphDateTime(e.start),
      end: graphDateTime(e.end),
    });
  }

  /** Any Graph-shaped event (all-day fixtures, copies with the property). */
  seedRaw(calendarId: string, event: Json): string {
    const id = this.nextId('evt');
    this.calendars.get(calendarId)?.events.set(id, { ...event, id });
    return id;
  }

  /** A fresh Graph-looking id (`evt`, `cal`) or etag (`tag`). */
  nextId(kind: 'evt' | 'cal' | 'tag'): string {
    return `AAMkAD${kind}${++this.seq}=`;
  }

  /** The event with this id in any calendar, or null. */
  findEvent(eventId: string): { calendarId: string; event: Json } | null {
    for (const [calendarId, cal] of this.calendars) {
      const event = cal.events.get(eventId);
      if (event) return { calendarId, event };
    }
    return null;
  }

  /** Drop a calendar (and its events) as if the user deleted it. */
  removeCalendar(calendarId: string): void {
    this.calendars.delete(calendarId);
  }

  readonly handle = (
    method: MicrosoftJsonMethod,
    url: string,
    accessToken: string,
    body?: unknown,
    opts?: MicrosoftJsonOptions,
  ): Promise<MicrosoftHttpResponse> => {
    this.requests.push({
      method,
      url,
      accessToken,
      body,
      prefer: opts?.prefer ?? [],
    });
    const failure = this.failures.shift();
    if (failure) return Promise.resolve(failure);
    if (url === MS_ME_URL)
      return Promise.resolve(reply(200, fixture('me-work')));
    const written = this.routeWrite(method, url, body);
    if (written) return Promise.resolve(written);
    return Promise.resolve(method === 'GET' ? this.routeGet(url) : bad());
  };

  /** Write routes (+ the write-side GETs); null = not a write route. */
  private routeWrite(
    method: MicrosoftJsonMethod,
    fullUrl: string,
    body: unknown,
  ): MicrosoftHttpResponse | null {
    const [rawPath = '', query = ''] = fullUrl.split('?');
    const path = rawPath.slice(GRAPH_API.length);
    const params = new URLSearchParams(query);
    if (path === '/me/calendars')
      return this.calendarsRoute(method, params, body);
    const one = /^\/me\/calendars\/([^/]+)$/.exec(path);
    if (one?.[1]) return this.oneCalendar(method, decodeURIComponent(one[1]));
    const events = /^\/me\/(?:calendar|calendars\/([^/]+))\/events$/.exec(path);
    if (events) {
      const id = events[1]
        ? decodeURIComponent(events[1])
        : FAKE_DEFAULT_CALENDAR_ID;
      return this.eventsRoute(method, id, params, body);
    }
    const ev = /^\/me\/events\/([^/]+)$/.exec(path);
    if (ev?.[1]) return this.oneEvent(method, decodeURIComponent(ev[1]), body);
    return null;
  }

  private calendarsRoute(
    method: MicrosoftJsonMethod,
    params: URLSearchParams,
    body: unknown,
  ): MicrosoftHttpResponse | null {
    if (method === 'GET') {
      const name = /^name eq '(.*)'$/.exec(params.get('$filter') ?? '')?.[1];
      if (name === undefined) return null;
      const value = this.calendarRows().filter((r) => r.name === name);
      return reply(200, { value });
    }
    if (method !== 'POST') return bad();
    const rawName = toJson(body).name;
    const name = typeof rawName === 'string' ? rawName : '';
    const taken = [...this.calendars.values()].some((c) => c.name === name);
    if (taken) return reply(409, { error: { code: 'ErrorFolderExists' } });
    const id = this.nextId('cal');
    this.addCalendar(id, name);
    return reply(201, { id, name, canEdit: true, isDefaultCalendar: false });
  }

  private oneCalendar(
    method: MicrosoftJsonMethod,
    id: string,
  ): MicrosoftHttpResponse {
    const cal = this.calendars.get(id);
    if (!cal) return reply(404, fixture('error-404'));
    if (method === 'GET') return reply(200, { id, name: cal.name });
    if (method !== 'DELETE') return bad();
    this.calendars.delete(id);
    return reply(204, null);
  }

  private eventsRoute(
    method: MicrosoftJsonMethod,
    calendarId: string,
    params: URLSearchParams,
    body: unknown,
  ): MicrosoftHttpResponse {
    const cal = this.calendars.get(calendarId);
    if (!cal) return reply(404, fixture('error-404'));
    if (method === 'GET')
      return reply(200, { value: adoptMatches(cal, params) });
    if (method !== 'POST') return bad();
    const id = this.nextId('evt');
    const event = { ...toJson(body), id, '@odata.etag': this.nextId('tag') };
    cal.events.set(id, event);
    return reply(201, event);
  }

  private oneEvent(
    method: MicrosoftJsonMethod,
    eventId: string,
    body: unknown,
  ): MicrosoftHttpResponse {
    const found = this.findEvent(eventId);
    const cal = found ? this.calendars.get(found.calendarId) : undefined;
    if (!found || !cal) return reply(404, fixture('error-404'));
    if (method === 'GET') return reply(200, found.event);
    if (method === 'DELETE') {
      cal.events.delete(eventId);
      return reply(204, null);
    }
    if (method !== 'PATCH') return bad();
    const etag = this.nextId('tag');
    const next = { ...found.event, ...toJson(body), '@odata.etag': etag };
    cal.events.set(eventId, next);
    return reply(200, next);
  }

  private routeGet(fullUrl: string): MicrosoftHttpResponse {
    const [path = '', query = ''] = fullUrl.split('?');
    const params = new URLSearchParams(query);
    if (path === `${GRAPH_API}/me/calendars`) {
      return this.page(fullUrl, params, this.calendarRows());
    }
    const view = /^\/me\/(?:calendar|calendars\/([^/]+))\/calendarView$/.exec(
      path.slice(GRAPH_API.length),
    );
    if (!view) return bad();
    const id = view[1] ? decodeURIComponent(view[1]) : FAKE_DEFAULT_CALENDAR_ID;
    const cal = this.calendars.get(id);
    if (!cal) return reply(404, fixture('error-404'));
    const rows = inWindow(cal, params).map((e) => this.viewRow(e));
    return this.page(fullUrl, params, rows);
  }

  /** Honoured expand: always the array (empty when not ours). */
  private viewRow(e: Json): Json {
    const { singleValueExtendedProperties: props, ...rest } = e;
    if (this.ignoreViewExpand) return rest;
    return { ...rest, singleValueExtendedProperties: props ?? [] };
  }

  private calendarRows(): Json[] {
    return [...this.calendars.entries()].map(([id, c]) => ({
      id,
      name: c.name,
      canEdit: c.canEdit,
      isDefaultCalendar: c.isDefaultCalendar,
    }));
  }

  /** One page of `rows`; `$skiptoken` is the offset, nextLink the same URL. */
  private page(url: string, params: URLSearchParams, rows: unknown[]) {
    const offset = Number(params.get('$skiptoken') ?? '0');
    const value = rows.slice(offset, offset + this.pageSize);
    const next = offset + this.pageSize;
    if (next >= rows.length) return reply(200, { value });
    const base = url.replace(/&\$skiptoken=\d+$/, '');
    return reply(200, {
      value,
      '@odata.nextLink': `${base}&$skiptoken=${next}`,
    });
  }
}

function newCalendar(name: string, canEdit: boolean, isDefault: boolean) {
  return { name, canEdit, isDefaultCalendar: isDefault, events: new Map() };
}

/** Occurrences overlapping `[startDateTime, endDateTime)`. */
function inWindow(cal: FakeGraphCalendar, params: URLSearchParams): Json[] {
  const min = Date.parse(params.get('startDateTime') ?? '');
  const max = Date.parse(params.get('endDateTime') ?? '');
  const at = (e: Json, k: 'start' | 'end'): number => {
    const v = e[k];
    const dt =
      v !== null && typeof v === 'object' && 'dateTime' in v ? v.dateTime : '';
    return Date.parse(`${String(dt)}Z`);
  };
  return [...cal.events.values()].filter(
    (e) => at(e, 'start') < max && at(e, 'end') > min,
  );
}

/** The adopt lookup: `ep/id eq '<prop>' and ep/value eq '<copyId>'`. */
function adoptMatches(cal: FakeGraphCalendar, params: URLSearchParams): Json[] {
  const filter = params.get('$filter') ?? '';
  const m = /ep\/id eq '(.*?)' and ep\/value eq '(.*?)'\)$/.exec(filter);
  if (!m) return [];
  const [, propId = '', value = ''] = m;
  const hits = [...cal.events.values()].filter((e) => {
    const props = e.singleValueExtendedProperties;
    return (
      Array.isArray(props) &&
      props.some((p) => {
        const prop = toJson(p);
        return prop.id === propId && prop.value === value;
      })
    );
  });
  const top = Number(params.get('$top') ?? '10');
  return hits.slice(0, top).map((e) => ({ id: e.id }));
}

function toJson(value: unknown): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

const bad = (): MicrosoftHttpResponse =>
  reply(400, { error: { code: 'BadRequest' } });

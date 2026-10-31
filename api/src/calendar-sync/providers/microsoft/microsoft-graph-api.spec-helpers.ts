/**
 * ROK-1597 (spec §6): an in-memory Microsoft Graph behind the
 * `microsoftJsonRequest` seam — the READ half (lane 7a-2): `/me`,
 * `/me/calendars` and `calendarView` with `@odata.nextLink` paging
 * (`pageSize` forces 2+ pages). Write routes (POST/PATCH/DELETE, the
 * extended-property `$filter`) are lane 7b-1's. Events are stored in
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
    const id = `AAMkADevt${++this.seq}=`;
    this.calendars.get(calendarId)?.events.set(id, { ...event, id });
    return id;
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
    return Promise.resolve(method === 'GET' ? this.routeGet(url) : bad());
  };

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
    return this.page(fullUrl, params, inWindow(cal, params));
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

const bad = (): MicrosoftHttpResponse =>
  reply(400, { error: { code: 'BadRequest' } });

/**
 * ROK-1596 G2: an in-memory Google Calendar v3 behind the
 * `googleJsonRequest` seam — calendars.insert/get/delete and
 * events.insert/patch/delete/list (the `rlCopyId` lookup, review M1), shaped
 * from the `__fixtures__` replies. A copy the user deleted is kept as
 * `status: cancelled` (`cancelEvent`), like Google.
 * Lets the write conformance suite run against the real adapter and the
 * real write helpers with no network. Install with
 * `jest.spyOn(googleHttp, 'googleJsonRequest').mockImplementation(api.handle)`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GoogleHttpResponse, GoogleJsonMethod } from './google-http';
import { GOOGLE_CALENDAR_API } from './google-write.helpers';

type Json = Record<string, unknown>;
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as Json;

const reply = (status: number, json: unknown): GoogleHttpResponse => ({
  status,
  json,
  retryAfter: null,
});

/** A request as the fake saw it (the token is kept for assertions only). */
export interface SeenRequest {
  method: GoogleJsonMethod;
  url: string;
  accessToken: string;
  body: unknown;
}

export class FakeGoogleCalendarApi {
  /** calendarId → (eventId → event JSON). `primary` always exists. */
  private readonly calendars = new Map<string, Map<string, Json>>([
    ['primary', new Map()],
  ]);
  private seq = 0;
  private readonly failures: GoogleHttpResponse[] = [];
  readonly requests: SeenRequest[] = [];

  /** ROK-1593: the next request answers this instead. */
  failNext(kind: 'auth' | 'rate' | 'transient'): void {
    const byKind = {
      auth: () => reply(401, fixture('events-401')),
      rate: () => reply(429, fixture('error-429')),
      transient: () => reply(503, { error: { code: 503 } }),
    };
    this.failures.push(byKind[kind]());
  }

  /** ROK-1593: a foreign event (no rlCopyId) on `calendarId`. */
  seedEvent(calendarId: string, e: { start: Date; end: Date; busy: boolean }) {
    const id = `foreign${++this.seq}`;
    this.calendars.get(calendarId)?.set(id, {
      id,
      status: 'confirmed',
      transparency: e.busy ? 'opaque' : 'transparent',
      start: { dateTime: e.start.toISOString() },
      end: { dateTime: e.end.toISOString() },
    });
  }

  /** Drop a calendar (and its events) as if the user deleted it. */
  removeCalendar(calendarId: string): void {
    this.calendars.delete(calendarId);
  }

  event(calendarId: string, eventId: string): Json | null {
    return this.calendars.get(calendarId)?.get(eventId) ?? null;
  }

  readonly handle = (
    method: GoogleJsonMethod,
    url: string,
    accessToken: string,
    body?: unknown,
  ): Promise<GoogleHttpResponse> => {
    this.requests.push({ method, url, accessToken, body });
    const failure = this.failures.shift();
    if (failure) return Promise.resolve(failure);
    if (url.startsWith(`${GOOGLE_CALENDAR_API}/users/me/calendarList`)) {
      return Promise.resolve(this.calendarList());
    }
    return Promise.resolve(this.route(method, url, body as Json));
  };

  /** The user deleted the copy in Google: it stays, as `cancelled`. */
  cancelEvent(calendarId: string, eventId: string): void {
    const cal = this.calendars.get(calendarId);
    const current = cal?.get(eventId);
    if (cal && current) cal.set(eventId, { ...current, status: 'cancelled' });
  }

  private route(m: GoogleJsonMethod, fullUrl: string, body: Json) {
    if (!fullUrl.startsWith(`${GOOGLE_CALENDAR_API}/calendars`)) {
      return reply(400, { error: { code: 400 } });
    }
    const [url = '', query = ''] = fullUrl.split('?');
    const path = url.slice(GOOGLE_CALENDAR_API.length + 1).split('/');
    const [, calId, events, evtId] = path.map(decodeURIComponent);
    if (!calId) return m === 'POST' ? this.insertCalendar() : bad();
    const cal = this.calendars.get(calId);
    if (!cal) return notFound();
    if (!events) return this.calendarOp(m, calId);
    if (!evtId && m === 'GET') return this.listEvents(cal, query);
    if (!evtId) return m === 'POST' ? this.insertEvent(cal, body) : bad();
    return this.eventOp(m, cal, evtId, body);
  }

  private insertCalendar(): GoogleHttpResponse {
    const id = `fixture-cal-${++this.seq}@group.calendar.google.com`;
    this.calendars.set(id, new Map());
    return reply(200, { ...fixture('calendar-insert-ok'), id });
  }

  private calendarOp(m: GoogleJsonMethod, calId: string) {
    if (m === 'GET') {
      return reply(200, { ...fixture('calendar-insert-ok'), id: calId });
    }
    if (m !== 'DELETE') return bad();
    this.calendars.delete(calId);
    return reply(204, null);
  }

  private insertEvent(cal: Map<string, Json>, body: Json) {
    const id = `fixtureevt${++this.seq}`;
    const event = { ...fixture('event-insert-ok'), ...body, id };
    cal.set(id, { ...event, etag: `"etag-${this.seq}"` });
    return reply(200, cal.get(id));
  }

  /** ROK-1593: every calendar, as the owner (`calendarList.list`). */
  private calendarList(): GoogleHttpResponse {
    const items = [...this.calendars.keys()].map((id) => ({
      id,
      summary: id === 'primary' ? 'me@example.test' : 'Raid Ledger',
      primary: id === 'primary',
      accessRole: 'owner',
    }));
    return reply(200, { items });
  }

  /** ROK-1593 read: live events overlapping `[timeMin, timeMax)`. */
  private eventsInRange(cal: Map<string, Json>, params: URLSearchParams) {
    const min = Date.parse(params.get('timeMin') ?? '');
    const max = Date.parse(params.get('timeMax') ?? '');
    const when = (e: Json, k: 'start' | 'end') =>
      Date.parse(String((e[k] as Json | undefined)?.dateTime));
    const items = [...cal.values()].filter(
      (e) =>
        e.status !== 'cancelled' &&
        when(e, 'start') < max &&
        when(e, 'end') > min,
    );
    return reply(200, { items });
  }

  /** `privateExtendedProperty=rlCopyId=<id>`; cancelled events left out. */
  private listEvents(cal: Map<string, Json>, query: string) {
    const params = new URLSearchParams(query);
    const filter = params.get('privateExtendedProperty');
    const wanted = filter?.startsWith('rlCopyId=') ? filter.slice(9) : null;
    if (!wanted) return this.eventsInRange(cal, params);
    const items = [...cal.values()].filter((e) => {
      const props = (e.extendedProperties as Json | undefined)?.private;
      const copyId = (props as Json | undefined)?.rlCopyId;
      return copyId === wanted && e.status !== 'cancelled';
    });
    return reply(200, { ...fixture('events-list-copy'), items });
  }

  private eventOp(
    m: GoogleJsonMethod,
    cal: Map<string, Json>,
    evtId: string,
    body: Json,
  ): GoogleHttpResponse {
    const current = cal.get(evtId);
    if (!current) return notFound();
    if (m === 'DELETE') {
      cal.delete(evtId);
      return reply(204, null);
    }
    if (m !== 'PATCH') return bad();
    cal.set(evtId, { ...current, ...body, etag: `"etag-${++this.seq}"` });
    return reply(200, cal.get(evtId));
  }
}

const notFound = () => reply(404, fixture('error-404'));
const bad = () => reply(400, { error: { code: 400 } });

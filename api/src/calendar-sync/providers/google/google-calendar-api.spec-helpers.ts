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
  readonly requests: SeenRequest[] = [];

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
    const [url, query = ''] = fullUrl.split('?');
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

  /** `privateExtendedProperty=rlCopyId=<id>`; cancelled events left out. */
  private listEvents(cal: Map<string, Json>, query: string) {
    const filter = new URLSearchParams(query).get('privateExtendedProperty');
    const wanted = filter?.startsWith('rlCopyId=') ? filter.slice(9) : null;
    if (!wanted) return bad();
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

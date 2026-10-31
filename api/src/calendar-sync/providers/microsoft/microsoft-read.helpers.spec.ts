/**
 * ROK-1597 T9 (mask) + T11 (paging guard): exact read URLs, the `primary`
 * alias, and that a nextLink to a non-Graph host is never followed.
 */
import * as microsoftHttp from './microsoft-http';
import {
  buildCalendarListUrl,
  buildCalendarViewUrl,
  readAllGraphPages,
} from './microsoft-read.helpers';
import {
  GRAPH_API,
  MICROSOFT_EVENTS_EXPAND,
  MICROSOFT_EVENTS_SELECT,
} from './microsoft-graph.constants';

const RANGE = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-11-29T00:00:00.000Z'),
};

afterEach(() => jest.restoreAllMocks());

describe('read masks (T9, §6.4.1)', () => {
  it('pins the calendarView $select and $expand strings', () => {
    expect(MICROSOFT_EVENTS_SELECT).toBe(
      'start,end,showAs,isAllDay,isCancelled,responseStatus,originalStartTimeZone',
    );
    expect(MICROSOFT_EVENTS_EXPAND).toBe(
      "singleValueExtendedProperties($filter=id eq 'String {5ee82885-bb24-48df-8d4a-123f14548871} Name rlCopyId')",
    );
  });

  it('builds the exact calendar list URL', () => {
    expect(buildCalendarListUrl()).toBe(
      `${GRAPH_API}/me/calendars?$select=id,name,canEdit,isDefaultCalendar&$top=100`,
    );
  });

  it('builds the exact calendarView URL with an encoded id', () => {
    const expand = encodeURIComponent(MICROSOFT_EVENTS_EXPAND);
    expect(buildCalendarViewUrl('AAMk/a=', RANGE)).toBe(
      `${GRAPH_API}/me/calendars/AAMk%2Fa%3D/calendarView` +
        '?startDateTime=2026-11-01T00%3A00%3A00.000Z&endDateTime=2026-11-29T00%3A00%3A00.000Z' +
        `&$select=${MICROSOFT_EVENTS_SELECT}&$expand=${expand}&$top=250`,
    );
  });

  it('maps the primary alias to /me/calendar', () => {
    expect(buildCalendarViewUrl('primary', RANGE)).toMatch(
      new RegExp(
        `^${GRAPH_API.replace(/\./g, '\\.')}/me/calendar/calendarView\\?`,
      ),
    );
  });
});

describe('readAllGraphPages', () => {
  it('never sends the token to a nextLink outside Graph', async () => {
    const spy = jest
      .spyOn(microsoftHttp, 'microsoftJsonRequest')
      .mockResolvedValue({
        status: 200,
        json: { value: [1], '@odata.nextLink': 'https://evil.example/next' },
        retryAfter: null,
      });
    const out = await readAllGraphPages('tok', `${GRAPH_API}/me/calendars`);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ items: [1], truncated: false });
  });
});

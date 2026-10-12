/**
 * ROK-1593 A3: Google read helpers — §6.4.1 exact masks, plan D3 drop rules
 * (Q-B birthday), all-day exclusive end, DST days, R2 on the ROK-1596 copy
 * fixture, D5 error mapping, and the privacy bar: no fixture text survives
 * into a BusyBlock.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as googleHttp from './google-http';
import {
  buildCalendarListUrl,
  buildEventsListUrl,
  GOOGLE_CALENDAR_LIST_FIELDS,
  GOOGLE_EVENTS_FIELDS,
  GOOGLE_READ_MAX_PAGES,
  mapGoogleReadError,
  normalizeGoogleEvent,
  readAllGooglePages,
  toProviderCalendar,
} from './google-calendar-read.helpers';
import {
  NotFoundError,
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import type { BusyBlock } from '../calendar-provider.interface';

type Json = Record<string, unknown>;
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as Json;
const itemsOf = (json: Json): Json[] => json.items as Json[];
function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}

const OURS = '0123456789ab';
const MIXED = itemsOf(fixture('events-mixed'));
const byId = (id: string): Json =>
  must(
    MIXED.find((i) => i.id === id),
    id,
  );
const RANGE = {
  start: new Date('2026-10-19T04:00:00.000Z'),
  end: new Date('2026-11-16T05:00:00.000Z'),
};
const res = (
  status: number,
  json: unknown,
  retryAfter: string | null = null,
) => ({
  status,
  json,
  retryAfter,
});

afterEach(() => jest.restoreAllMocks());

describe('§6.4.1 read masks', () => {
  it('pins the exact events.list and calendarList field masks', () => {
    expect(GOOGLE_EVENTS_FIELDS).toBe(
      'nextPageToken,items(status,start,end,transparency,eventType,iCalUID,extendedProperties/private,attendees(self,responseStatus))',
    );
    expect(GOOGLE_CALENDAR_LIST_FIELDS).toBe(
      'nextPageToken,items(id,summary,primary,accessRole)',
    );
  });

  it('events.list URL carries the window, singleEvents and the mask', () => {
    const url = new URL(buildEventsListUrl('me@example.test', RANGE, 'pt-2'));
    expect(url.pathname).toBe(
      '/calendar/v3/calendars/me%40example.test/events',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      timeMin: '2026-10-19T04:00:00.000Z',
      timeMax: '2026-11-16T05:00:00.000Z',
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
      fields: GOOGLE_EVENTS_FIELDS,
      pageToken: 'pt-2',
    });
  });

  it('calendarList URL asks for freeBusyReader and up with its mask', () => {
    const url = new URL(buildCalendarListUrl());
    expect(url.pathname).toBe('/calendar/v3/users/me/calendarList');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      minAccessRole: 'freeBusyReader',
      fields: GOOGLE_CALENDAR_LIST_FIELDS,
    });
  });
});

describe('normalizeGoogleEvent — plan D3 drop rules', () => {
  it.each([
    ['mx02', 'transparency=transparent'],
    ['mx03', 'status=cancelled'],
    ['mx04', 'self attendee declined'],
    ['mx05', 'eventType=workingLocation'],
    ['mx06', 'eventType=focusTime'],
    ['mx07', 'eventType=birthday (Q-B)'],
    ['mx10', 'our own copy (R2)'],
  ])('drops %s (%s)', (id) => {
    expect(normalizeGoogleEvent(byId(id), OURS)).toBeNull();
  });

  it('keeps default, outOfOffice, fromGmail, all-day and a foreign copy', () => {
    const kept = MIXED.filter((i) => normalizeGoogleEvent(i, OURS) !== null);
    expect(kept.map((i) => i.id)).toEqual([
      'mx01',
      'mx08',
      'mx09',
      'mx11',
      'mx12',
    ]);
  });

  it('drops a self "Maybe" RSVP but keeps one where only a guest is tentative (Q3)', () => {
    const withRsvp = (self: boolean): Json => ({
      ...byId('mx01'),
      attendees: [{ self, responseStatus: 'tentative' }],
    });
    expect(normalizeGoogleEvent(withRsvp(true), OURS)).toBeNull();
    expect(normalizeGoogleEvent(withRsvp(false), OURS)).not.toBeNull();
  });

  it('a timed event becomes exact UTC instants and nothing else', () => {
    expect(normalizeGoogleEvent(byId('mx01'), OURS)).toEqual({
      start: new Date('2026-10-20T22:00:00.000Z'),
      end: new Date('2026-10-20T23:30:00.000Z'),
      allDay: false,
    });
  });
});

describe('normalizeGoogleEvent — dates and instants', () => {
  it('all-day end.date is exclusive: lastInclusive = end.date − 1 day', () => {
    expect(normalizeGoogleEvent(byId('mx09'), OURS)).toEqual({
      start: new Date('2026-10-27T00:00:00.000Z'),
      end: new Date('2026-10-29T00:00:00.000Z'),
      allDay: true,
      allDayDates: { first: '2026-10-27', lastInclusive: '2026-10-28' },
    });
  });

  it('an all-day span across a DST change keeps its calendar dates', () => {
    const item = { start: { date: '2026-10-31' }, end: { date: '2026-11-02' } };
    expect(normalizeGoogleEvent(item, OURS)?.allDayDates).toEqual({
      first: '2026-10-31',
      lastInclusive: '2026-11-01',
    });
  });

  it.each([
    [
      'fall back',
      '2026-11-01T01:30:00-04:00',
      '2026-11-01T01:30:00-05:00',
      '2026-11-01T05:30:00.000Z',
    ],
    [
      'spring forward',
      '2026-03-08T01:30:00-05:00',
      '2026-03-08T03:30:00-04:00',
      '2026-03-08T06:30:00.000Z',
    ],
  ])('a DST-day (%s) timed event lasts its real hour', (_, from, to, utc) => {
    const block = normalizeGoogleEvent(
      { start: { dateTime: from }, end: { dateTime: to } },
      OURS,
    );
    expect(block?.start.toISOString()).toBe(utc);
    expect((block?.end.getTime() ?? 0) - (block?.start.getTime() ?? 0)).toBe(
      3_600_000,
    );
  });

  it.each([
    [
      'floating time (no offset)',
      { dateTime: '2026-10-20T10:00:00' },
      { dateTime: '2026-10-20T11:00:00' },
    ],
    [
      'inverted',
      { dateTime: '2026-10-20T11:00:00Z' },
      { dateTime: '2026-10-20T10:00:00Z' },
    ],
    [
      'mixed date + dateTime',
      { date: '2026-10-20' },
      { dateTime: '2026-10-21T00:00:00Z' },
    ],
    ['impossible date', { date: '2026-02-30' }, { date: '2026-03-01' }],
    ['empty all-day', { date: '2026-10-20' }, { date: '2026-10-20' }],
  ])('unusable bounds (%s) → null', (_, start, end) => {
    expect(normalizeGoogleEvent({ start, end }, OURS)).toBeNull();
  });
});

describe('normalizeGoogleEvent — R2 + privacy', () => {
  const copy = must(itemsOf(fixture('events-list-copy'))[0], 'copy item');

  it('R2: the ROK-1596 events-list-copy item is dropped for its own instance', () => {
    expect(normalizeGoogleEvent(copy, OURS)).toBeNull();
  });

  it('R2: the same copy seen by another instance is busy and carries ourId', () => {
    expect(normalizeGoogleEvent(copy, 'fedcba987654')?.ourId).toBe(
      'rl:0123456789ab:42:7',
    );
    expect(normalizeGoogleEvent(byId('mx11'), OURS)?.ourId).toBe(
      'rl:fedcba987654:9:3',
    );
  });

  it('with no instance (adapter path) our copy is kept with ourId for the runner', () => {
    expect(normalizeGoogleEvent(byId('mx10'), null)?.ourId).toBe(
      'rl:0123456789ab:42:7',
    );
  });

  it('output keys ⊆ BusyBlock keys and no fixture text survives', () => {
    const blocks = MIXED.map((i) => normalizeGoogleEvent(i, null)).filter(
      (b): b is BusyBlock => b !== null,
    );
    const allowed = ['start', 'end', 'allDay', 'allDayDates', 'ourId'];
    for (const b of blocks) {
      expect(Object.keys(b).filter((k) => !allowed.includes(k))).toEqual([]);
    }
    const out = JSON.stringify(blocks);
    const texts = MIXED.flatMap((i) => [
      i.summary,
      i.location,
      i.description,
      i.iCalUID,
      ...((i.attendees as Json[] | undefined) ?? []).map((a) => a.email),
    ]).filter((t): t is string => typeof t === 'string');
    expect(texts.length).toBeGreaterThan(15);
    expect(texts.filter((t) => out.includes(t))).toEqual([]);
  });
});

describe('mapGoogleReadError (plan D5)', () => {
  const thrown = (r: ReturnType<typeof res>): unknown => {
    try {
      mapGoogleReadError(r);
    } catch (err) {
      return err;
    }
    return null;
  };

  it('2xx passes; 401 → auth; 403 scope → auth(scope)', () => {
    expect(thrown(res(200, {}))).toBeNull();
    const auth = thrown(res(401, fixture('events-401')));
    expect(auth).toBeInstanceOf(ProviderAuthError);
    expect((auth as ProviderAuthError).reason).toBe('http_401');
    const scope = thrown(res(403, fixture('events-403-scope')));
    expect(scope).toBeInstanceOf(ProviderAuthError);
    expect((scope as ProviderAuthError).reason).toBe('scope');
  });

  it('403 rate / 429 → RateLimitError waiting at least 60 s', () => {
    const rate = thrown(res(403, fixture('events-403-rate'), '5'));
    expect(rate).toBeInstanceOf(RateLimitError);
    expect((rate as RateLimitError).retryAfterMs).toBe(60_000);
    const slow = thrown(res(429, fixture('error-429'), '120'));
    expect((slow as RateLimitError).retryAfterMs).toBe(120_000);
  });

  it('404, 410 and a plain 403 → NotFound (calendar skipped); 5xx → transient', () => {
    expect(thrown(res(404, fixture('error-404')))).toBeInstanceOf(
      NotFoundError,
    );
    expect(thrown(res(410, null))).toBeInstanceOf(NotFoundError);
    expect(thrown(res(403, { error: { code: 403 } }))).toBeInstanceOf(
      NotFoundError,
    );
    expect(thrown(res(503, null))).toBeInstanceOf(TransientError);
  });
});

describe('calendarList rows + paging', () => {
  it('maps the picker rows; names shown, writable from accessRole', () => {
    const rows = itemsOf(fixture('calendar-list')).map(toProviderCalendar);
    expect(rows).toEqual([
      {
        id: 'fixture-owner@example.test',
        name: 'fixture-owner@example.test',
        primary: true,
        writable: true,
        isRaidLedger: false,
      },
      {
        id: 'team-fixture@group.calendar.google.com',
        name: 'Team fixture',
        primary: false,
        writable: true,
        isRaidLedger: false,
      },
      {
        id: 'holidays-fixture@group.v.calendar.google.com',
        name: 'Holidays fixture',
        primary: false,
        writable: false,
        isRaidLedger: false,
      },
      {
        id: 'boss-fixture@example.test',
        name: '',
        primary: false,
        writable: false,
        isRaidLedger: false,
      },
    ]);
    expect(toProviderCalendar({ summary: 'no id' })).toBeNull();
  });

  it(`stops after ${GOOGLE_READ_MAX_PAGES} pages and reports truncation`, async () => {
    const get = jest
      .spyOn(googleHttp, 'googleJsonRequest')
      .mockResolvedValue(res(200, { items: [{}], nextPageToken: 'again' }));
    const out = await readAllGooglePages('tok', (p) => `https://x/${p ?? ''}`);
    expect(get).toHaveBeenCalledTimes(GOOGLE_READ_MAX_PAGES);
    expect(out).toEqual({ items: Array(10).fill({}), truncated: true });
  });

  it('network failure → TransientError(network); timeout → (timeout)', async () => {
    const get = jest.spyOn(googleHttp, 'googleJsonRequest');
    get.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(
      readAllGooglePages('tok', () => 'https://x'),
    ).rejects.toMatchObject({
      constructor: TransientError,
      reason: 'network',
    });
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    get.mockRejectedValueOnce(timeout);
    await expect(
      readAllGooglePages('tok', () => 'https://x'),
    ).rejects.toMatchObject({
      reason: 'timeout',
    });
  });
});

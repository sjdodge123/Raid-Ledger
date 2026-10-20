import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';
import { zonedToUtc } from './apple-ical-time.helpers';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8').replace(
    /\r?\n/g,
    '\r\n',
  );
const range = {
  start: new Date('2026-10-20T00:00:00Z'),
  end: new Date('2026-11-17T00:00:00Z'),
};
const spans = (ics: string, calendarTimezone: string | null = null) =>
  parseBusyFromIcs(ics, { range, calendarTimezone }).blocks.map((b) => [
    b.start.toISOString(),
    b.end.toISOString(),
  ]);
const stripVtimezone = (ics: string) =>
  ics.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/, '');

describe('all-day events (T7)', () => {
  it('yields date bounds that are never shifted through the collection zone', () => {
    const { blocks } = parseBusyFromIcs(fixture('all-day.ics'), {
      range,
      calendarTimezone: 'Pacific/Auckland',
    });
    const twoDays = {
      start: new Date('2026-11-03T00:00:00.000Z'),
      end: new Date('2026-11-05T00:00:00.000Z'),
      allDay: true,
      allDayDates: { first: '2026-11-03', lastInclusive: '2026-11-04' },
    };
    expect(blocks).toEqual([
      twoDays,
      twoDays,
      {
        start: new Date('2026-11-03T00:00:00.000Z'),
        end: new Date('2026-11-04T00:00:00.000Z'),
        allDay: true,
        allDayDates: { first: '2026-11-03', lastInclusive: '2026-11-03' },
      },
    ]);
  });
});

describe('TZID across the Berlin DST end (T8)', () => {
  const expected = [
    ['2026-10-24T17:00:00.000Z', '2026-10-24T19:00:00.000Z'],
    ['2026-10-26T18:00:00.000Z', '2026-10-26T20:00:00.000Z'],
  ];

  it('resolves through the VCALENDAR’s own VTIMEZONE', () => {
    expect(spans(fixture('berlin-vtimezone.ics'))).toEqual(expected);
  });

  it('resolves the same TZID as an IANA zone when no VTIMEZONE is sent', () => {
    expect(spans(stripVtimezone(fixture('berlin-vtimezone.ics')))).toEqual(
      expected,
    );
  });

  it('skips an event whose TZID is neither defined nor an IANA zone', () => {
    const ics = stripVtimezone(fixture('berlin-vtimezone.ics')).replace(
      /Europe\/Berlin/g,
      'Mars/Olympus_Mons',
    );
    expect(parseBusyFromIcs(ics, { range, calendarTimezone: null })).toEqual({
      blocks: [],
      skipped: 2,
    });
  });
});

describe('floating times + DURATION (Q5)', () => {
  it('places a floating time in the collection’s IANA calendar-timezone', () => {
    expect(spans(fixture('floating.ics'), 'America/Los_Angeles')).toEqual([
      ['2026-10-22T02:00:00.000Z', '2026-10-22T03:30:00.000Z'],
    ]);
  });

  it('places it via a calendar-timezone VTIMEZONE text', () => {
    const vtz = fixture('weekly-ny.ics').match(
      /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/,
    )?.[0];
    expect(vtz).toBeDefined();
    expect(
      spans(
        fixture('floating.ics'),
        `BEGIN:VCALENDAR\r\n${vtz ?? ''}END:VCALENDAR\r\n`,
      ),
    ).toEqual([['2026-10-21T23:00:00.000Z', '2026-10-22T00:30:00.000Z']]);
  });

  it('falls back to UTC with no (or an unusable) calendar-timezone', () => {
    const utc = [['2026-10-21T19:00:00.000Z', '2026-10-21T20:30:00.000Z']];
    expect(spans(fixture('floating.ics'), null)).toEqual(utc);
    expect(spans(fixture('floating.ics'), 'Not/A_Zone')).toEqual(utc);
  });
});

describe('zonedToUtc', () => {
  const wall = {
    year: 2026,
    month: 11,
    day: 3,
    hour: 19,
    minute: 0,
    second: 0,
  };

  it('converts a wall-clock time in an IANA zone', () => {
    expect(
      new Date(zonedToUtc(wall, 'America/New_York') ?? 0).toISOString(),
    ).toBe('2026-11-04T00:00:00.000Z');
  });

  it('returns null for an unknown zone', () => {
    expect(zonedToUtc(wall, 'Nowhere/Land')).toBeNull();
  });
});

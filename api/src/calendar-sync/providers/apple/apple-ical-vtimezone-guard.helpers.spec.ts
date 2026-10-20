import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8').replace(
    /\r?\n/g,
    '\r\n',
  );
const range = {
  start: new Date('2026-10-20T00:00:00Z'),
  end: new Date('2026-11-17T00:00:00Z'),
};
const berlin = fixture('berlin-vtimezone.ics');
const DAYLIGHT_RULE = 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU';
const withDaylightRule = (ics: string, rule: string): string =>
  ics.replace(DAYLIGHT_RULE, `RRULE:${rule}`);
const parse = (ics: string, calendarTimezone: string | null = null) =>
  parseBusyFromIcs(ics, { range, calendarTimezone });
const spans = (ics: string, calendarTimezone: string | null = null) =>
  parse(ics, calendarTimezone).blocks.map((b) => [
    b.start.toISOString(),
    b.end.toISOString(),
  ]);
const expected = [
  ['2026-10-24T17:00:00.000Z', '2026-10-24T19:00:00.000Z'],
  ['2026-10-26T18:00:00.000Z', '2026-10-26T20:00:00.000Z'],
];

describe('a VTIMEZONE observance rule ical.js cannot expand in bounded time (Codex r11)', () => {
  it.each([
    'FREQ=YEARLY;INTERVAL=1000000000',
    'FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=SECONDLY',
    'FREQ=MINUTELY',
  ])(
    '%s → the TZID resolves through IANA, fast',
    (rule) => {
      const began = Date.now();
      expect(spans(withDaylightRule(berlin, rule))).toEqual(expected);
      expect(Date.now() - began).toBeLessThan(1000);
    },
    10_000,
  );

  it('skips the events when the TZID is not an IANA zone either', () => {
    const ics = withDaylightRule(berlin, 'FREQ=SECONDLY').replace(
      /Europe\/Berlin/g,
      'Mars/Olympus_Mons',
    );
    expect(parse(ics)).toEqual({ blocks: [], skipped: 2 });
  }, 10_000);

  it('keeps a well-formed VTIMEZONE (its own rules, not IANA)', () => {
    expect(spans(berlin)).toEqual(expected);
  });

  it('a costly collection calendar-timezone falls back to its IANA TZID', () => {
    const vtz = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/.exec(berlin)?.[0];
    if (!vtz) throw new Error('fixture has no VTIMEZONE');
    const zone = `BEGIN:VCALENDAR\r\n${withDaylightRule(vtz, 'FREQ=SECONDLY')}END:VCALENDAR\r\n`;
    const floating = berlin
      .replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/, '')
      .replace(/;TZID=Europe\/Berlin/g, '');
    const began = Date.now();
    expect(spans(floating, zone)).toEqual(expected);
    expect(Date.now() - began).toBeLessThan(1000);
  }, 10_000);
});

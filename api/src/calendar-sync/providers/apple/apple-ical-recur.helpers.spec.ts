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
const parse = (ics: string) =>
  parseBusyFromIcs(ics, { range, calendarTimezone: null });
const starts = (ics: string) =>
  parse(ics).blocks.map((b) => b.start.toISOString());

describe('weekly series across the New York DST end (T9)', () => {
  const expected = [
    '2026-10-20T23:00:00.000Z',
    '2026-10-27T23:00:00.000Z',
    '2026-11-04T00:00:00.000Z',
    '2026-11-11T00:00:00.000Z',
  ];

  it('expands inside the window only, 23:00Z before and 00:00Z after 11-01', () => {
    expect(starts(fixture('weekly-ny.ics'))).toEqual(expected);
  });

  it('gives the same instants through the Intl path (no VTIMEZONE)', () => {
    const bare = fixture('weekly-ny.ics').replace(
      /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/,
      '',
    );
    expect(starts(bare)).toEqual(expected);
  });

  it('keeps the two-hour duration on every occurrence', () => {
    const hours = parse(fixture('weekly-ny.ics')).blocks.map(
      (b) => (b.end.getTime() - b.start.getTime()) / 3_600_000,
    );
    expect(hours).toEqual([2, 2, 2, 2]);
  });
});

describe('EXDATE + RECURRENCE-ID overrides (T10)', () => {
  it('drops the EXDATE, moves the override, removes the cancelled override', () => {
    expect(starts(fixture('weekly-ny-exceptions.ics'))).toEqual([
      '2026-10-20T23:00:00.000Z',
      '2026-11-05T00:00:00.000Z',
    ]);
  });

  it('judges overrides on their own times: moved out excluded, moved in included', () => {
    expect(starts(fixture('moved-overrides.ics')).sort()).toEqual([
      '2026-10-20T12:00:00.000Z',
      '2026-11-03T12:00:00.000Z',
      '2026-11-10T12:00:00.000Z',
      '2026-11-12T12:00:00.000Z',
    ]);
  });
});

describe('iteration cap (T11)', () => {
  it('stops an unbounded MINUTELY series at the cap without throwing', () => {
    const started = Date.now();
    const result = parse(fixture('minutely-forever.ics'));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.skipped).toBe(1);
    expect(result.blocks.map((b) => b.start.toISOString())).toEqual([
      '2026-10-21T18:00:00.000Z',
    ]);
  });
});

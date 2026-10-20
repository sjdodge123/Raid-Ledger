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

describe('RECURRENCE-ID;RANGE=THISANDFUTURE (review r1)', () => {
  it('moves the changed occurrence and every later one to the new times', () => {
    const blocks = parse(fixture('daily-thisandfuture.ics')).blocks;
    const rows = blocks
      .map((b) => `${b.start.toISOString()}/${b.end.toISOString()}`)
      .sort();
    expect(rows).toEqual([
      '2026-10-21T12:00:00.000Z/2026-10-21T13:00:00.000Z',
      '2026-10-22T12:00:00.000Z/2026-10-22T13:00:00.000Z',
      '2026-10-23T15:00:00.000Z/2026-10-23T17:00:00.000Z',
      '2026-10-24T15:00:00.000Z/2026-10-24T17:00:00.000Z',
      '2026-10-25T15:00:00.000Z/2026-10-25T17:00:00.000Z',
    ]);
  });
});

describe('nominal DURATION days across the New York DST end (review r1)', () => {
  const vtimezone = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/.exec(
    fixture('weekly-ny.ics'),
  )?.[0];
  const event = (zone: string) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `${zone}BEGIN:VEVENT`,
      'UID:p1d@icloud.test',
      'DTSTART;TZID=America/New_York:20261031T120000',
      'DURATION:P1D',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  const ends = (ics: string) =>
    parse(ics).blocks.map((b) => [b.start.toISOString(), b.end.toISOString()]);
  const expected = [['2026-10-31T16:00:00.000Z', '2026-11-01T17:00:00.000Z']];

  it('P1D from noon EDT ends at noon EST (17:00Z) — Intl path', () => {
    expect(ends(event(''))).toEqual(expected);
  });

  it('P1D from noon EDT ends at noon EST (17:00Z) — VTIMEZONE path', () => {
    expect(vtimezone).toBeDefined();
    expect(ends(event(vtimezone ?? ''))).toEqual(expected);
  });
});

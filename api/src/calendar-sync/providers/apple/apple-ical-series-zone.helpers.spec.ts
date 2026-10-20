import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';

const nyZone = (): string => {
  const ics = readFileSync(
    join(__dirname, '__fixtures__', 'weekly-ny.ics'),
    'utf8',
  ).replace(/\r?\n/g, '\r\n');
  const block = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/.exec(ics)?.[0];
  if (!block) throw new Error('fixture has no VTIMEZONE');
  return block.trimEnd();
};
const range = {
  start: new Date('2026-10-20T00:00:00Z'),
  end: new Date('2026-11-17T00:00:00Z'),
};
const ics = (zone: string, extra: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    zone,
    'BEGIN:VEVENT',
    'UID:other-zone-exdate@icloud.test',
    'DTSTART;TZID=America/New_York:20261025T190000',
    'DTEND;TZID=America/New_York:20261025T200000',
    'RRULE:FREQ=DAILY;COUNT=4',
    ...extra,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ]
    .filter((l, i, all) => l.length > 0 || i === all.length - 1)
    .join('\r\n');
const starts = (text: string): string[] =>
  parseBusyFromIcs(text, { range, calendarTimezone: null })
    .blocks.map((b) => b.start.toISOString())
    .sort();

describe('EXDATE / RDATE in another IANA zone, master with a VTIMEZONE (Codex r11)', () => {
  const exdate = ['EXDATE;TZID=Asia/Tokyo:20261028T080000'];
  const rdate = ['RDATE;TZID=Asia/Tokyo:20261105T120000'];
  const daily = [
    '2026-10-25T23:00:00.000Z',
    '2026-10-26T23:00:00.000Z',
    '2026-10-27T23:00:00.000Z',
    '2026-10-28T23:00:00.000Z',
  ];
  const withoutOct27 = daily.filter((s) => !s.startsWith('2026-10-27'));

  it.each([
    ['VTIMEZONE', nyZone()],
    ['no VTIMEZONE', ''],
  ])('a Tokyo EXDATE removes the New York occurrence (%s)', (_, zone) => {
    expect(starts(ics(zone, exdate))).toEqual(withoutOct27);
  });

  it.each([
    ['VTIMEZONE', nyZone()],
    ['no VTIMEZONE', ''],
  ])('a Tokyo RDATE lands at its own instant (%s)', (_, zone) => {
    expect(starts(ics(zone, rdate))).toEqual([
      ...daily,
      '2026-11-05T03:00:00.000Z',
    ]);
  });
});

describe('a UTC series, override RECURRENCE-ID in a DST fold (Codex r12)', () => {
  const berlinZone = (): string => {
    const text = readFileSync(
      join(__dirname, '__fixtures__', 'berlin-vtimezone.ics'),
      'utf8',
    ).replace(/\r?\n/g, '\r\n');
    const block = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/.exec(text)?.[0];
    if (!block) throw new Error('fixture has no VTIMEZONE');
    return block.trimEnd();
  };
  const event = (lines: string[]): string[] => [
    'BEGIN:VEVENT',
    'UID:utc-fold@icloud.test',
    ...lines,
    'END:VEVENT',
  ];
  const feed = (zone: string): string =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      ...(zone ? [zone] : []),
      ...event([
        'DTSTART:20261024T003000Z',
        'DTEND:20261024T013000Z',
        'RRULE:FREQ=DAILY;COUNT=3',
      ]),
      ...event([
        'RECURRENCE-ID;TZID=Europe/Berlin:20261025T023000',
        'DTSTART:20261025T100000Z',
        'DTEND:20261025T110000Z',
      ]),
      'END:VCALENDAR',
      '',
    ].join('\r\n');

  it.each([
    ['VTIMEZONE', berlinZone()],
    ['no VTIMEZONE', ''],
  ])('the 02:30 first occurrence (00:30Z) is the one moved (%s)', (_, zone) => {
    expect(starts(feed(zone))).toEqual([
      '2026-10-24T00:30:00.000Z',
      '2026-10-25T10:00:00.000Z',
      '2026-10-26T00:30:00.000Z',
    ]);
  });
});

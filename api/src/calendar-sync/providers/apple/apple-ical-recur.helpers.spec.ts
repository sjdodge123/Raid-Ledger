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

describe('IANA TZID without VTIMEZONE compares UNTIL / EXDATE as instants (Codex r2)', () => {
  const series = (lines: string[]) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:zone@icloud.test',
      ...lines,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');

  it('daily 19:00 Asia/Tokyo with UNTIL=20261022T100000Z includes Oct 22', () => {
    const ics = series([
      'DTSTART;TZID=Asia/Tokyo:20261020T190000',
      'DTEND;TZID=Asia/Tokyo:20261020T200000',
      'RRULE:FREQ=DAILY;UNTIL=20261022T100000Z',
    ]);
    expect(starts(ics)).toEqual([
      '2026-10-20T10:00:00.000Z',
      '2026-10-21T10:00:00.000Z',
      '2026-10-22T10:00:00.000Z',
    ]);
  });

  it('a New York series drops the occurrence named by an equivalent UTC EXDATE', () => {
    const ics = series([
      'DTSTART;TZID=America/New_York:20261006T190000',
      'DTEND;TZID=America/New_York:20261006T210000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE:20261027T230000Z',
    ]);
    expect(starts(ics)).toEqual([
      '2026-10-20T23:00:00.000Z',
      '2026-11-04T00:00:00.000Z',
      '2026-11-11T00:00:00.000Z',
    ]);
  });
});

describe('RDATE-only series include DTSTART (Codex r2)', () => {
  const rdateOnly = (extra: string[]) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:rdate@icloud.test',
      'DTSTART:20261020T120000Z',
      'DTEND:20261020T130000Z',
      ...extra,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');

  it('DTSTART Oct 20 + RDATE Oct 22 → two blocks', () => {
    expect(starts(rdateOnly(['RDATE:20261022T120000Z']))).toEqual([
      '2026-10-20T12:00:00.000Z',
      '2026-10-22T12:00:00.000Z',
    ]);
  });

  it('an RDATE repeating DTSTART is not counted twice', () => {
    const ics = rdateOnly(['RDATE:20261020T120000Z,20261022T120000Z']);
    expect(starts(ics)).toEqual([
      '2026-10-20T12:00:00.000Z',
      '2026-10-22T12:00:00.000Z',
    ]);
  });

  it('an EXDATE on DTSTART still removes it', () => {
    const ics = rdateOnly([
      'RDATE:20261022T120000Z',
      'EXDATE:20261020T120000Z',
    ]);
    expect(starts(ics)).toEqual(['2026-10-22T12:00:00.000Z']);
  });
});

const rows = (ics: string) =>
  parse(ics)
    .blocks.map((b) => `${b.start.toISOString()}/${b.end.toISOString()}`)
    .sort();

describe('RDATE;VALUE=PERIOD (Codex r3)', () => {
  it('keeps DTSTART and gives each period occurrence its own end', () => {
    const result = parse(fixture('period-rdate.ics'));
    expect(result.skipped).toBe(0);
    expect(rows(fixture('period-rdate.ics'))).toEqual([
      '2026-10-21T12:00:00.000Z/2026-10-21T13:00:00.000Z',
      '2026-10-22T12:00:00.000Z/2026-10-22T15:00:00.000Z',
      '2026-10-23T12:00:00.000Z/2026-10-23T12:30:00.000Z',
    ]);
  });
});

describe('transparent master + opaque THISANDFUTURE override (Codex r3)', () => {
  it('a four-day transparent series made opaque from day two → three busy blocks', () => {
    expect(rows(fixture('transparent-thisandfuture.ics'))).toEqual([
      '2026-10-22T12:00:00.000Z/2026-10-22T13:00:00.000Z',
      '2026-10-23T12:00:00.000Z/2026-10-23T13:00:00.000Z',
      '2026-10-24T12:00:00.000Z/2026-10-24T13:00:00.000Z',
    ]);
  });

  it('a transparent master with no busy override still yields nothing', () => {
    const ics = fixture('transparent-thisandfuture.ics').replace(
      'TRANSP:OPAQUE',
      'TRANSP:TRANSPARENT',
    );
    expect(rows(ics)).toEqual([]);
  });
});

describe('bare IANA series: THISANDFUTURE shift on the series wall clock (Codex r3)', () => {
  it('weekly 19:00 New York moved to 22:00Z on Oct 27 → Nov 3 at 23:00Z (after DST)', () => {
    expect(rows(fixture('weekly-ny-bare-thisandfuture.ics'))).toEqual([
      '2026-10-20T23:00:00.000Z/2026-10-21T01:00:00.000Z',
      '2026-10-27T22:00:00.000Z/2026-10-28T00:00:00.000Z',
      '2026-11-03T23:00:00.000Z/2026-11-04T01:00:00.000Z',
      '2026-11-10T23:00:00.000Z/2026-11-11T01:00:00.000Z',
    ]);
  });
});

describe('THISANDFUTURE override moving occurrences backward (Codex r4)', () => {
  it('a five-day series from Nov 18 with Nov 19 moved to Nov 1 → Nov 1–4 in a window ending Nov 17', () => {
    expect(rows(fixture('backward-thisandfuture.ics'))).toEqual([
      '2026-11-01T12:00:00.000Z/2026-11-01T13:00:00.000Z',
      '2026-11-02T12:00:00.000Z/2026-11-02T13:00:00.000Z',
      '2026-11-03T12:00:00.000Z/2026-11-03T13:00:00.000Z',
      '2026-11-04T12:00:00.000Z/2026-11-04T13:00:00.000Z',
    ]);
  });
});

describe('zero-duration master with period RDATEs (Codex r4)', () => {
  it('skips the empty Oct 20 DTSTART but keeps the Oct 22 12:00–15:00 period', () => {
    const result = parse(fixture('zero-duration-period-rdate.ics'));
    expect(result.skipped).toBe(0);
    expect(rows(fixture('zero-duration-period-rdate.ics'))).toEqual([
      '2026-10-22T12:00:00.000Z/2026-10-22T15:00:00.000Z',
    ]);
  });
});

function vtimezoneOf(ics: string): string {
  const block = /BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r\n/.exec(ics)?.[0];
  if (!block) throw new Error('fixture has no VTIMEZONE');
  return block;
}

describe('zoned series (VTIMEZONE) + UTC THISANDFUTURE override (Codex r5)', () => {
  it('weekly 19:00 New York moved to 22:00Z on Oct 27 → Nov 3 at 23:00Z (after DST)', () => {
    const ics = fixture('weekly-ny-bare-thisandfuture.ics').replace(
      'CALSCALE:GREGORIAN\r\n',
      `CALSCALE:GREGORIAN\r\n${vtimezoneOf(fixture('weekly-ny.ics'))}`,
    );
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(rows(ics)).toEqual([
      '2026-10-20T23:00:00.000Z/2026-10-21T01:00:00.000Z',
      '2026-10-27T22:00:00.000Z/2026-10-28T00:00:00.000Z',
      '2026-11-03T23:00:00.000Z/2026-11-04T01:00:00.000Z',
      '2026-11-10T23:00:00.000Z/2026-11-11T01:00:00.000Z',
    ]);
  });
});

describe('zero-duration master + positive THISANDFUTURE override (Codex r5)', () => {
  it('a four-day empty series from Oct 21 given one hour from Oct 22 → Oct 22–24', () => {
    const ics = fixture('transparent-thisandfuture.ics')
      .replace('DTEND:20261021T130000Z', 'DTEND:20261021T120000Z')
      .replace('TRANSP:TRANSPARENT', 'TRANSP:OPAQUE');
    expect(rows(ics)).toEqual([
      '2026-10-22T12:00:00.000Z/2026-10-22T13:00:00.000Z',
      '2026-10-23T12:00:00.000Z/2026-10-23T13:00:00.000Z',
      '2026-10-24T12:00:00.000Z/2026-10-24T13:00:00.000Z',
    ]);
  });
});

describe('zoned series whose VTIMEZONE TZID is unknown to Intl (Codex r6)', () => {
  it('converts the UTC override with the embedded rules → Nov 3 at 23:00Z', () => {
    const ics = fixture('weekly-ny-bare-thisandfuture.ics')
      .replace(
        'CALSCALE:GREGORIAN\r\n',
        `CALSCALE:GREGORIAN\r\n${vtimezoneOf(fixture('weekly-ny.ics'))}`,
      )
      .replace(/America\/New_York/g, 'Custom/New_York');
    expect(ics).toContain('TZID:Custom/New_York');
    expect(rows(ics)).toEqual([
      '2026-10-20T23:00:00.000Z/2026-10-21T01:00:00.000Z',
      '2026-10-27T22:00:00.000Z/2026-10-28T00:00:00.000Z',
      '2026-11-03T23:00:00.000Z/2026-11-04T01:00:00.000Z',
      '2026-11-10T23:00:00.000Z/2026-11-11T01:00:00.000Z',
    ]);
  });
});

describe('THISANDFUTURE DURATION:PT24H across the New York DST end (Codex r6)', () => {
  const expected = [
    '2026-10-29T16:00:00.000Z/2026-10-29T17:00:00.000Z',
    '2026-10-30T16:00:00.000Z/2026-10-31T16:00:00.000Z',
    '2026-10-31T16:00:00.000Z/2026-11-01T16:00:00.000Z',
    '2026-11-01T17:00:00.000Z/2026-11-02T17:00:00.000Z',
  ];
  const ics = fixture('daily-ny-duration-thisandfuture.ics');
  const wideParse = (text: string) =>
    parseBusyFromIcs(text, {
      range: { start: new Date('2026-10-25T00:00:00Z'), end: range.end },
      calendarTimezone: null,
    })
      .blocks.map((b) => `${b.start.toISOString()}/${b.end.toISOString()}`)
      .sort();

  it('keeps the exact 24 hours on the shifted Oct 31 occurrence (VTIMEZONE)', () => {
    expect(wideParse(ics)).toEqual(expected);
  });

  it('keeps the exact 24 hours through the Intl path (no VTIMEZONE)', () => {
    expect(wideParse(ics.replace(vtimezoneOf(ics), ''))).toEqual(expected);
  });
});

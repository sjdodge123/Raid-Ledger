import {
  escapeIcsText,
  foldIcsLine,
  formatIcsUtc,
  serializeIcsCalendar,
  type IcsEvent,
} from './ics-serialize.helpers';

const octets = (s: string) => Buffer.byteLength(s, 'utf8');

const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: 'rl-42@raid.example.test',
  start: new Date('2026-10-11T18:00:00.000Z'),
  end: new Date('2026-10-11T21:30:00.000Z'),
  summary: 'Raid Night',
  stamp: new Date('2026-10-01T09:05:07.456Z'),
  ...over,
});

describe('formatIcsUtc', () => {
  it('renders the UTC form YYYYMMDDTHHMMSSZ, dropping milliseconds', () => {
    expect(formatIcsUtc(new Date('2026-01-02T03:04:05.678Z'))).toBe(
      '20260102T030405Z',
    );
  });

  it('converts an offset instant to UTC', () => {
    expect(formatIcsUtc(new Date('2026-10-11T20:00:00+02:00'))).toBe(
      '20261011T180000Z',
    );
  });
});

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and every newline form', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe(
      'a\\\\b\\;c\\,d\\ne\\nf\\ng',
    );
  });

  it('escapes the backslash first so escapes are not doubled', () => {
    expect(escapeIcsText(';')).toBe('\\;');
    expect(escapeIcsText('\\;')).toBe('\\\\\\;');
  });
});

describe('foldIcsLine', () => {
  it('leaves a line of exactly 75 octets alone', () => {
    const line = 'X'.repeat(75);
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds at 75 octets with CRLF + one space, and unfolds losslessly', () => {
    const line = `SUMMARY:${'a'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBe(3);
    expect(physical.map(octets)).toEqual([75, 75, 1 + 208 - 75 - 74]);
    expect(physical.slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('never splits a multi-byte character at the 75-octet boundary', () => {
    // 74 ASCII octets, then a 3-octet '€' that would straddle octet 75.
    const line = `${'a'.repeat(74)}€${'b'.repeat(10)}`;
    const physical = foldIcsLine(line).split('\r\n');
    expect(physical[0]).toBe('a'.repeat(74));
    expect(physical[1]).toBe(` €${'b'.repeat(10)}`);
    expect(physical.every((l) => octets(l) <= 75)).toBe(true);
    expect(physical.join('').replace(/^(a+) /, '$1')).toBe(line);
  });

  it('keeps 4-octet characters (emoji) whole across many folds', () => {
    const line = `SUMMARY:${'🐉'.repeat(40)}`;
    const physical = foldIcsLine(line).split('\r\n');
    expect(physical.every((l) => octets(l) <= 75)).toBe(true);
    expect(physical.every((l) => !l.includes('�'))).toBe(true);
    expect(foldIcsLine(line).replace(/\r\n /g, '')).toBe(line);
  });
});

describe('serializeIcsCalendar', () => {
  const ics = serializeIcsCalendar({
    prodId: '-//Raid Ledger//Events//EN',
    events: [
      event({
        description:
          'https://raid.example.test/events/42\n\nBring flasks; food, too',
        url: 'https://raid.example.test/events/42',
        status: 'CANCELLED',
      }),
    ],
  });
  const lines = ics.split('\r\n');

  it('uses CRLF line endings only and ends with a CRLF', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('wraps exactly one VEVENT in a VCALENDAR 2.0 with the PRODID', () => {
    expect(lines.slice(0, 5)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Raid Ledger//Events//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ]);
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('writes the stable UID, DTSTAMP and UTC DTSTART/DTEND', () => {
    expect(lines).toContain('UID:rl-42@raid.example.test');
    expect(lines).toContain('DTSTAMP:20261001T090507Z');
    expect(lines).toContain('DTSTART:20261011T180000Z');
    expect(lines).toContain('DTEND:20261011T213000Z');
    expect(lines).toContain('STATUS:CANCELLED');
  });

  it('escapes TEXT properties but not the URL', () => {
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(
      'DESCRIPTION:https://raid.example.test/events/42\\n\\nBring flasks\\; food\\, too',
    );
    expect(unfolded).toContain('URL:https://raid.example.test/events/42\r\n');
  });

  it('produces the same bytes for the same input (stable output)', () => {
    const again = serializeIcsCalendar({
      prodId: '-//Raid Ledger//Events//EN',
      events: [event()],
    });
    expect(again).toBe(
      serializeIcsCalendar({
        prodId: '-//Raid Ledger//Events//EN',
        events: [event()],
      }),
    );
    expect(again).not.toContain('DESCRIPTION');
  });
});

describe('serializeIcsCalendar — revision fields (review NIT)', () => {
  it('writes SEQUENCE and LAST-MODIFIED only when given', () => {
    const lastModified = new Date('2026-10-02T10:00:00.000Z');
    const withRev = serializeIcsCalendar({
      prodId: '-//T//T//EN',
      events: [event({ sequence: 3, lastModified })],
    }).split('\r\n');
    expect(withRev).toContain('SEQUENCE:3');
    expect(withRev).toContain('LAST-MODIFIED:20261002T100000Z');
    const without = serializeIcsCalendar({
      prodId: '-//T//T//EN',
      events: [event()],
    });
    expect(without).not.toMatch(/SEQUENCE|LAST-MODIFIED/);
  });
});

describe('serializeIcsCalendar — TRANSP and refresh interval (ROK-1599)', () => {
  const lines = (ics: string) => ics.split('\r\n');

  it('emits TRANSP inside the VEVENT only when transparency is set', () => {
    const ics = serializeIcsCalendar({
      prodId: '-//Test//EN',
      events: [event({ transparency: 'TRANSPARENT' }), event({ uid: 'b' })],
    });
    expect(lines(ics).filter((l) => l.startsWith('TRANSP:'))).toEqual([
      'TRANSP:TRANSPARENT',
    ]);
    const first = ics.slice(0, ics.indexOf('END:VEVENT'));
    expect(first).toContain('TRANSP:TRANSPARENT\r\n');
  });

  it('emits REFRESH-INTERVAL and X-PUBLISHED-TTL when refreshInterval is set', () => {
    const ics = serializeIcsCalendar({
      prodId: '-//Test//EN',
      refreshInterval: 'PT1H',
      events: [],
    });
    expect(lines(ics)).toEqual(
      expect.arrayContaining([
        'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
        'X-PUBLISHED-TTL:PT1H',
      ]),
    );
    const plain = serializeIcsCalendar({ prodId: '-//Test//EN', events: [] });
    expect(plain).not.toContain('REFRESH-INTERVAL');
    expect(plain).not.toContain('X-PUBLISHED-TTL');
  });
});

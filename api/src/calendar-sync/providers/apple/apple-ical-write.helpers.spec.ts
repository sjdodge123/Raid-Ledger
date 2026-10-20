import type { CopyEventInput } from '../calendar-provider.interface';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';
import { buildCopyIcs } from './apple-ical-write.helpers';

const input = (over: Partial<CopyEventInput> = {}): CopyEventInput => ({
  copyId: 'rl:0123456789ab:42:7',
  title: 'Raid Night, Molten Core',
  description:
    'Bring flasks; fire resist gear needed for the whole raid team. Pull at 19:15 sharp.',
  url: 'https://raid.example.test/events/42',
  start: new Date('2026-10-21T18:00:00.000Z'),
  end: new Date('2026-10-21T21:00:00.000Z'),
  tentative: false,
  ...over,
});
const now = new Date('2026-10-20T09:05:07.456Z');

const golden = (summary: string, status: string, transp: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Raid Ledger//Calendar Sync//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:rl:0123456789ab:42:7',
    'X-RAID-LEDGER-ID:rl:0123456789ab:42:7',
    'DTSTAMP:20261020T090507Z',
    'DTSTART:20261021T180000Z',
    'DTEND:20261021T210000Z',
    `SUMMARY:${summary}`,
    'DESCRIPTION:Bring flasks\\; fire resist gear needed for the whole raid team.',
    '  Pull at 19:15 sharp.',
    'URL:https://raid.example.test/events/42',
    `STATUS:${status}`,
    `TRANSP:${transp}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

describe('buildCopyIcs (T15)', () => {
  it('confirmed → OPAQUE, plain title', () => {
    expect(buildCopyIcs(input(), now)).toBe(
      golden('Raid Night\\, Molten Core', 'CONFIRMED', 'OPAQUE'),
    );
  });

  it('tentative → TRANSPARENT, "(Tentative) " title', () => {
    expect(buildCopyIcs(input({ tentative: true }), now)).toBe(
      golden(
        '(Tentative) Raid Night\\, Molten Core',
        'TENTATIVE',
        'TRANSPARENT',
      ),
    );
  });

  it('benched → TRANSPARENT, "(Bench) " title', () => {
    expect(buildCopyIcs(input({ benched: true }), now)).toBe(
      golden('(Bench) Raid Night\\, Molten Core', 'CONFIRMED', 'TRANSPARENT'),
    );
  });

  it('round-trips through the read path as our own busy copy', () => {
    const { blocks } = parseBusyFromIcs(buildCopyIcs(input(), now), {
      range: {
        start: new Date('2026-10-20T00:00:00Z'),
        end: new Date('2026-10-22T00:00:00Z'),
      },
      calendarTimezone: null,
    });
    expect(blocks).toEqual([
      {
        start: new Date('2026-10-21T18:00:00.000Z'),
        end: new Date('2026-10-21T21:00:00.000Z'),
        allDay: false,
        ourId: 'rl:0123456789ab:42:7',
      },
    ]);
  });
});

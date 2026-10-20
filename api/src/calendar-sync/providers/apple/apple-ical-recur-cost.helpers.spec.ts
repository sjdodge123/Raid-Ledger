import ICAL from 'ical.js';
import { parseBusyFromIcs } from './apple-ical-parse.helpers';
import { MAX_INTERVAL, isCostlyRule } from './apple-ical-recur-cost.helpers';

const range = {
  start: new Date('2026-10-20T00:00:00Z'),
  end: new Date('2026-11-17T00:00:00Z'),
};

/** A one-hour series starting inside the window, plus a plain neighbour. */
const seriesIcs = (rrule: string): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:interval@icloud.test',
    'DTSTART:20261021T120000Z',
    'DTEND:20261021T130000Z',
    `RRULE:${rrule}`,
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:good-neighbour@icloud.test',
    'DTSTART:20261022T180000Z',
    'DTEND:20261022T190000Z',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

function costly(rrule: string): boolean {
  const cal = ICAL.Component.fromString(seriesIcs(rrule));
  const master = cal.getFirstSubcomponent('vevent');
  if (master === null) throw new Error('fixture has no VEVENT');
  return isCostlyRule(master, range.end);
}

describe('INTERVAL ceilings bound ical.js stepping (Codex r10)', () => {
  it.each(Object.entries(MAX_INTERVAL))(
    'keeps FREQ=%s at its ceiling (%d) and refuses one past it',
    (freq, ceiling) => {
      expect(costly(`FREQ=${freq};INTERVAL=${ceiling}`)).toBe(false);
      expect(costly(`FREQ=${freq};INTERVAL=${ceiling + 1}`)).toBe(true);
    },
  );

  it.each([
    'FREQ=DAILY;INTERVAL=1000000000',
    'FREQ=WEEKLY;INTERVAL=100000000;BYDAY=MO',
    'FREQ=HOURLY;INTERVAL=100000000000',
    'FREQ=MINUTELY;INTERVAL=1000000000000',
  ])('refuses %s before an iterator is built', (rule) => {
    expect(costly(rule)).toBe(true);
  });

  it('keeps ordinary intervals', () => {
    expect(costly('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU')).toBe(false);
    expect(costly('FREQ=YEARLY;INTERVAL=4')).toBe(false);
  });

  it('skips a DAILY;INTERVAL=1000000000 series in < 1 s and keeps the neighbour', () => {
    const started = Date.now();
    const result = parseBusyFromIcs(
      seriesIcs('FREQ=DAILY;INTERVAL=1000000000'),
      {
        range,
        calendarTimezone: null,
      },
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.skipped).toBe(1);
    expect(result.blocks.map((b) => b.start.toISOString())).toEqual([
      '2026-10-22T18:00:00.000Z',
    ]);
  }, 10_000);
});

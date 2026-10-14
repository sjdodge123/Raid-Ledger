import {
  hasTzMismatch,
  type TzCheckSchedule,
} from './pelican-tz-check.helpers';

function schedule(over: Partial<TzCheckSchedule> = {}): TzCheckSchedule {
  return {
    cronMinute: '0',
    cronHour: '4',
    cronDayOfMonth: '*',
    cronMonth: '*',
    cronDayOfWeek: '*',
    isActive: true,
    nextRunAt: new Date('2026-10-31T08:00:00Z'), // 04:00 EDT
    ...over,
  };
}

const TZ_CASES: [string, TzCheckSchedule[], string, boolean][] = [
  [
    'next run is 04:00 local in the server tz',
    [schedule()],
    'America/New_York',
    false,
  ],
  ['same row read in UTC (4 h off)', [schedule()], 'UTC', true],
  [
    '5 h off (America/Chicago reads 03:00)',
    [schedule()],
    'America/Chicago',
    true,
  ],
  [
    'stale next run (long past) still matches',
    [schedule({ nextRunAt: new Date('2026-01-05T09:00:00Z') })],
    'America/New_York',
    false,
  ],
  [
    'inactive mismatching schedule is ignored',
    [schedule({ isActive: false })],
    'UTC',
    false,
  ],
  [
    'null nextRunAt is inconclusive',
    [schedule({ nextRunAt: null })],
    'UTC',
    false,
  ],
  ['no schedules is inconclusive', [], 'UTC', false],
  [
    'half-hour zone matches',
    [schedule({ nextRunAt: new Date('2026-10-30T22:30:00Z') })],
    'Asia/Kolkata',
    false,
  ],
  [
    'half-hour zone read in UTC mismatches',
    [schedule({ nextRunAt: new Date('2026-10-30T22:30:00Z') })],
    'UTC',
    true,
  ],
  [
    'within tolerance (+45 s)',
    [schedule({ nextRunAt: new Date('2026-10-31T08:00:45Z') })],
    'America/New_York',
    false,
  ],
  [
    'outside tolerance (+90 s)',
    [schedule({ nextRunAt: new Date('2026-10-31T08:01:30Z') })],
    'America/New_York',
    true,
  ],
  [
    'ANY mismatching active schedule flags the server',
    [schedule(), schedule({ cronHour: '5' })],
    'America/New_York',
    true,
  ],
  [
    'an unparseable cron is inconclusive',
    [schedule({ cronMinute: '61' })],
    'UTC',
    false,
  ],
];

describe('hasTzMismatch (ruling 4 — membership test)', () => {
  it.each(TZ_CASES)('%s → %s', (_label, schedules, tz, expected) => {
    expect(hasTzMismatch(schedules, tz)).toBe(expected);
  });
});

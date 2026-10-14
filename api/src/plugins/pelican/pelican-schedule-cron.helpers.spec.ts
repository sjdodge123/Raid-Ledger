import {
  expandBetween,
  isOccurrence,
  nextAtOrAfter,
  prevBefore,
  toCronExpression,
} from './pelican-schedule-cron.helpers';

const NY = 'America/New_York';
const iso = (dates: Date[]): string[] => dates.map((d) => d.toISOString());
const localHour = (d: Date, tz: string): number =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(d));
const expand = (expr: string, tz: string, from: string, to: string, limit = 100) =>
  expandBetween(expr, tz, new Date(from), new Date(to), limit);

describe('toCronExpression', () => {
  const fields = {
    cronMinute: '0',
    cronHour: '*/2',
    cronDayOfMonth: '*',
    cronMonth: '1-6',
    cronDayOfWeek: '1,3',
  };

  it('joins the five stored fields in cron order', () => {
    expect(toCronExpression(fields)).toBe('0 */2 * 1-6 1,3');
  });

  it.each([[''], ['0 4'], [' ']])('rejects a field of %j (would shift fields)', (bad) => {
    expect(() => toCronExpression({ ...fields, cronHour: bad })).toThrow('Invalid cron field');
  });
});

describe('expandBetween — 0 4 * * * in America/New_York across 2026 DST', () => {
  it.each([
    [
      'DST ends Sun 2026-11-01',
      '2026-10-30T12:00:00Z',
      '2026-11-03T00:00:00Z',
      ['2026-10-31T08:00:00.000Z', '2026-11-01T09:00:00.000Z', '2026-11-02T09:00:00.000Z'],
    ],
    [
      'DST starts Sun 2026-03-08',
      '2026-03-06T12:00:00Z',
      '2026-03-10T00:00:00Z',
      ['2026-03-07T09:00:00.000Z', '2026-03-08T08:00:00.000Z', '2026-03-09T08:00:00.000Z'],
    ],
  ])('%s: 04:00 local on both sides', (_label, from, to, expected) => {
    const runs = expand('0 4 * * *', NY, from, to);
    expect(iso(runs)).toEqual(expected);
    expect(runs.map((d) => localHour(d, NY))).toEqual([4, 4, 4]);
  });

  // Ruling 3: keep cron-parser's behaviour and pin it. Pelican's own
  // scheduler (dragonmantank/cron-expression) may differ on these two days.
  it('characterization: 02:30 on spring-forward day (does not exist) fires at 03:30 EDT', () => {
    const runs = expand('30 2 * * *', NY, '2026-03-07T00:00:00Z', '2026-03-10T00:00:00Z');
    expect(iso(runs)).toEqual([
      '2026-03-07T07:30:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-09T06:30:00.000Z',
    ]);
    expect(runs.map((d) => localHour(d, NY))).toEqual([2, 3, 2]);
  });

  it('characterization: 01:30 on fall-back day (happens twice) fires ONCE, on the EDT pass', () => {
    const runs = expand('30 1 * * *', NY, '2026-10-31T00:00:00Z', '2026-11-03T00:00:00Z');
    expect(iso(runs)).toEqual([
      '2026-10-31T05:30:00.000Z',
      '2026-11-01T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
  });
});

describe('expandBetween — bounds and limit', () => {
  it('includes a run exactly at `from` and excludes one exactly at `to`', () => {
    const runs = expand('0 4 * * *', 'UTC', '2026-10-14T04:00:00Z', '2026-10-16T04:00:00Z');
    expect(iso(runs)).toEqual(['2026-10-14T04:00:00.000Z', '2026-10-15T04:00:00.000Z']);
  });

  it('excludes a run that precedes a mid-minute `from`', () => {
    const runs = expand('0 4 * * *', 'UTC', '2026-10-14T04:00:00.500Z', '2026-10-15T05:00:00Z');
    expect(iso(runs)).toEqual(['2026-10-15T04:00:00.000Z']);
  });

  it('stops at `limit`', () => {
    const runs = expand('* * * * *', 'UTC', '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 7);
    expect(runs).toHaveLength(7);
  });

  it('throws on an expression cron-parser rejects', () => {
    expect(() => expand('61 * * * *', 'UTC', '2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z')).toThrow();
  });
});

describe('prevBefore / nextAtOrAfter', () => {
  const at = new Date('2026-10-31T08:00:00Z');

  it('prevBefore is strictly before', () => {
    expect(prevBefore('0 4 * * *', NY, at).toISOString()).toBe('2026-10-30T08:00:00.000Z');
  });

  it('nextAtOrAfter includes `at` itself', () => {
    expect(nextAtOrAfter('0 4 * * *', NY, at).toISOString()).toBe('2026-10-31T08:00:00.000Z');
  });

  it('nextAtOrAfter crosses the DST change in local time', () => {
    const next = nextAtOrAfter('0 4 * * *', NY, new Date('2026-10-31T08:00:01Z'));
    expect(next.toISOString()).toBe('2026-11-01T09:00:00.000Z');
  });
});

describe('isOccurrence (±60 s)', () => {
  const run = '2026-10-31T08:00:00Z';
  it.each([
    ['exact run', NY, run, true],
    ['45 s late', NY, '2026-10-31T08:00:45Z', true],
    ['45 s early', NY, '2026-10-31T07:59:15Z', true],
    ['2 min late', NY, '2026-10-31T08:02:00Z', false],
    ['same instant read in UTC (04:00 local ≠ 08:00 UTC)', 'UTC', run, false],
  ])('%s → %s', (_label, tz, at, expected) => {
    expect(isOccurrence('0 4 * * *', tz, new Date(at), 60_000)).toBe(expected);
  });
});

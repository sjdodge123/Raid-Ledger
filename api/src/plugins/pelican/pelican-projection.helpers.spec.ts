import {
  GameServerCalendarItemSchema,
  GameServerMarkerItemSchema,
  GameServerWindowItemSchema,
  type GameServerCalendarItemDto,
} from '@raid-ledger/contract';
import {
  projectSchedules,
  type ProjectionInput,
  type ProjectionSchedule,
} from './pelican-projection.helpers';

const NY = 'America/New_York';
let nextId = 1;

function cron(
  expr: string,
): Pick<
  ProjectionSchedule,
  'cronMinute' | 'cronHour' | 'cronDayOfMonth' | 'cronMonth' | 'cronDayOfWeek'
> {
  const f = expr.split(' ');
  if (f.length !== 5) throw new Error(`bad test cron ${expr}`);
  const [
    cronMinute = '',
    cronHour = '',
    cronDayOfMonth = '',
    cronMonth = '',
    cronDayOfWeek = '',
  ] = f;
  return { cronMinute, cronHour, cronDayOfMonth, cronMonth, cronDayOfWeek };
}

function sched(
  expr: string,
  effect: string,
  over: Partial<ProjectionSchedule> = {},
): ProjectionSchedule {
  return {
    id: nextId++,
    serverId: 1,
    name: '',
    ...cron(expr),
    isActive: true,
    nextRunAt: null,
    effect,
    effectOffsetS: 0,
    gameId: 7,
    serverName: 'Valheim',
    serverTimezone: NY,
    ...over,
  };
}

function project(
  schedules: ProjectionSchedule[],
  from: string,
  to: string,
  extra: Partial<ProjectionInput> = {},
) {
  return projectSchedules({
    schedules,
    defaultTimezone: 'UTC',
    range: { from: new Date(from), to: new Date(to) },
    ...extra,
  });
}

/** Compact, comparable view of an item. */
function brief(item: GameServerCalendarItemDto): string {
  return item.kind === 'window'
    ? `window ${item.start} -> ${item.end} ${item.label}`
    : `marker ${item.effect} ${item.at} ${item.label}`;
}
const briefs = (input: ReturnType<typeof project>): string[] =>
  input.items.map(brief);

const START = sched('0 18 * * *', 'start', { name: 'Evening up' });
const STOP = sched('0 2 * * *', 'stop', { name: 'Night down' });

const WINDOW_CASES: [string, ProjectionSchedule[], string, string, string[]][] =
  [
    [
      'start 18:00 + stop 02:00 → one window crossing midnight',
      [START, STOP],
      '2026-10-14T12:00:00-04:00',
      '2026-10-15T12:00:00-04:00',
      [
        'window 2026-10-14T22:00:00.000Z -> 2026-10-15T06:00:00.000Z Evening up',
      ],
    ],
    [
      'range starts inside a window → look-behind start opens it',
      [START, STOP],
      '2026-10-14T00:00:00-04:00',
      '2026-10-14T12:00:00-04:00',
      [
        'window 2026-10-13T22:00:00.000Z -> 2026-10-14T06:00:00.000Z Evening up',
      ],
    ],
    [
      'range starts after the stop → no window spans `from`',
      [START, STOP],
      '2026-10-14T03:00:00-04:00',
      '2026-10-14T12:00:00-04:00',
      [],
    ],
    [
      'stop after `to` → look-ahead closes it, end unclipped',
      [START, STOP],
      '2026-10-14T12:00:00-04:00',
      '2026-10-14T23:00:00-04:00',
      [
        'window 2026-10-14T22:00:00.000Z -> 2026-10-15T06:00:00.000Z Evening up',
      ],
    ],
    [
      'a second start while open is ignored',
      [START, sched('0 20 * * *', 'start', { name: 'Late up' }), STOP],
      '2026-10-14T12:00:00-04:00',
      '2026-10-15T12:00:00-04:00',
      [
        'window 2026-10-14T22:00:00.000Z -> 2026-10-15T06:00:00.000Z Evening up',
      ],
    ],
    [
      'restart inside an open window → window + marker',
      [START, sched('0 22 * * *', 'restart'), STOP],
      '2026-10-14T12:00:00-04:00',
      '2026-10-15T12:00:00-04:00',
      [
        'window 2026-10-14T22:00:00.000Z -> 2026-10-15T06:00:00.000Z Evening up',
        'marker restart 2026-10-15T02:00:00.000Z Restart',
      ],
    ],
    [
      'kill closes a window like stop',
      [START, sched('0 2 * * *', 'kill')],
      '2026-10-14T12:00:00-04:00',
      '2026-10-15T12:00:00-04:00',
      [
        'window 2026-10-14T22:00:00.000Z -> 2026-10-15T06:00:00.000Z Evening up',
      ],
    ],
    [
      'start with no stop schedule → start markers',
      [sched('0 18 * * *', 'start')],
      '2026-10-14T00:00:00-04:00',
      '2026-10-16T00:00:00-04:00',
      [
        'marker start 2026-10-14T22:00:00.000Z Server online',
        'marker start 2026-10-15T22:00:00.000Z Server online',
      ],
    ],
    [
      'unpaired stop → stop marker',
      [STOP],
      '2026-10-14T00:00:00-04:00',
      '2026-10-15T00:00:00-04:00',
      ['marker stop 2026-10-14T06:00:00.000Z Night down'],
    ],
  ];

describe('projectSchedules — windows (D6/D7, ruling 2)', () => {
  it.each(WINDOW_CASES)('%s', (_label, schedules, from, to, expected) => {
    expect(briefs(project(schedules, from, to))).toEqual(expected);
  });
});

const localHour = (iso: string): number =>
  Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: NY,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(iso)),
  );
const markerTimes = (r: ReturnType<typeof project>): string[] =>
  r.items.flatMap((i) => (i.kind === 'marker' ? [i.at] : []));

describe('projectSchedules — DST', () => {
  it.each([
    [
      'DST end',
      '2026-10-30T12:00:00Z',
      '2026-11-03T00:00:00Z',
      [
        '2026-10-31T08:00:00.000Z',
        '2026-11-01T09:00:00.000Z',
        '2026-11-02T09:00:00.000Z',
      ],
    ],
    [
      'DST start',
      '2026-03-06T12:00:00Z',
      '2026-03-10T00:00:00Z',
      [
        '2026-03-07T09:00:00.000Z',
        '2026-03-08T08:00:00.000Z',
        '2026-03-09T08:00:00.000Z',
      ],
    ],
  ])(
    '0 4 * * * restart in New York, %s: 04:00 local every day',
    (_l, from, to, expected) => {
      const at = markerTimes(
        project([sched('0 4 * * *', 'restart')], from, to),
      );
      expect(at).toEqual(expected);
      expect(at.map(localHour)).toEqual([4, 4, 4]);
    },
  );
});

describe('projectSchedules — offset and default tz', () => {
  it('applies the (cumulative) effect offset exactly once', () => {
    const r = project(
      [sched('0 4 * * *', 'restart', { effectOffsetS: 300 })],
      '2026-10-14T00:00:00-04:00',
      '2026-10-15T00:00:00-04:00',
    );
    expect(markerTimes(r)).toEqual(['2026-10-14T08:05:00.000Z']);
  });

  it('keeps an effect at 00:01 whose cron fired at 23:59 the day before the range (D4)', () => {
    const s = sched('59 23 * * *', 'backup', {
      effectOffsetS: 120,
      serverTimezone: 'UTC',
    });
    expect(
      markerTimes(project([s], '2026-10-14T00:00:00Z', '2026-10-14T12:00:00Z')),
    ).toEqual(['2026-10-14T00:01:00.000Z']);
  });

  it('uses the plugin default tz when the server has no override', () => {
    const r = project(
      [sched('0 4 * * *', 'restart', { serverTimezone: null })],
      '2026-10-14T00:00:00Z',
      '2026-10-15T00:00:00Z',
      { defaultTimezone: 'Europe/Berlin' },
    );
    expect(markerTimes(r)).toEqual(['2026-10-14T02:00:00.000Z']);
  });
});

describe('projectSchedules — filtering', () => {
  const day = ['2026-10-14T00:00:00Z', '2026-10-16T00:00:00Z'] as const;

  it('inactive schedules produce nothing', () => {
    expect(
      project([sched('0 4 * * *', 'restart', { isActive: false })], ...day)
        .items,
    ).toEqual([]);
  });

  it('honours gameIds', () => {
    const a = sched('0 4 * * *', 'restart', { serverId: 1, gameId: 7 });
    const b = sched('0 5 * * *', 'restart', { serverId: 2, gameId: 9 });
    expect(project([a, b], ...day, { gameIds: [11] }).items).toEqual([]);
    expect(
      project([a, b], ...day, { gameIds: [9] }).items.map((i) => i.serverKey),
    ).toEqual(['2', '2']);
    expect(project([a, b], ...day).items).toHaveLength(4);
  });
});

describe('projectSchedules — cap, tz flag, skips', () => {
  const day = ['2026-10-14T00:00:00Z', '2026-10-16T00:00:00Z'] as const;

  it('caps at 500 in-range occurrences per server and reports it', () => {
    const r = project(
      [sched('*/1 * * * *', 'command', { serverId: 4 })],
      ...day,
    );
    expect(r.items).toHaveLength(500);
    expect(r.truncatedServerIds).toEqual([4]);
  });

  it('does not report a server under the cap as truncated', () => {
    expect(
      project([sched('0 * * * *', 'command')], ...day).truncatedServerIds,
    ).toEqual([]);
  });

  it('flags a tz mismatch but still projects the server', () => {
    const s = sched('0 4 * * *', 'restart', {
      serverTimezone: 'UTC',
      nextRunAt: new Date('2026-10-14T08:00:00Z'),
    });
    const r = project([s], ...day);
    expect(r.tzMismatchServerIds).toEqual([1]);
    expect(r.items).toHaveLength(2);
  });

  it('skips a bad tz server and a bad cron schedule without dropping the rest', () => {
    const badTz = sched('0 4 * * *', 'restart', {
      serverId: 2,
      serverTimezone: 'Mars/Olympus',
    });
    const badCron = sched('61 4 * * *', 'restart');
    const good = sched('0 4 * * *', 'backup');
    const r = project([badTz, badCron, good], ...day);
    expect(r.skipped).toEqual([
      { serverId: 1, scheduleId: badCron.id, reason: 'bad_cron' },
      { serverId: 2, reason: 'bad_tz' },
    ]);
    expect(r.items.map((i) => i.kind === 'marker' && i.effect)).toEqual([
      'backup',
      'backup',
    ]);
  });
});

describe('projectSchedules — output contract (D12/D13)', () => {
  const r = project(
    [
      sched('0 18 * * *', 'start', {
        serverName: 'EU 10.0.0.5:27015',
        name: 'up http://x.y',
      }),
      sched('0 2 * * *', 'stop', { serverName: 'EU 10.0.0.5:27015' }),
      sched('0 22 * * *', 'restart', {
        serverName: 'EU 10.0.0.5:27015',
        name: 'restart http://x.y',
      }),
    ],
    '2026-10-14T00:00:00-04:00',
    '2026-10-16T00:00:00-04:00',
  );

  it('yields both kinds', () => {
    expect(new Set(r.items.map((i) => i.kind))).toEqual(
      new Set(['window', 'marker']),
    );
  });

  it.each(r.items.map((item) => [brief(item), item] as const))(
    '%s parses and has no extra keys',
    (_b, item) => {
      expect(GameServerCalendarItemSchema.safeParse(item).success).toBe(true);
      const allowed = Object.keys(
        item.kind === 'window'
          ? GameServerWindowItemSchema.shape
          : GameServerMarkerItemSchema.shape,
      );
      expect(Object.keys(item).filter((k) => !allowed.includes(k))).toEqual([]);
      expect(item).toMatchObject({
        serverKey: '1',
        serverName: 'EU',
        gameId: 7,
        provider: 'Pelican',
      });
    },
  );

  it('leaks no address from server or schedule names', () => {
    const json = JSON.stringify(r.items);
    expect(json).not.toContain('10.0.0.5');
    expect(json).not.toContain('x.y');
  });
});

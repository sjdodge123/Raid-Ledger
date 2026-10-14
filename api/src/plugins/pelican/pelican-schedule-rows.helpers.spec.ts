import {
  PelicanScheduleListSchema,
  type PelicanSchedule,
  type PelicanTask,
} from './pelican-api.schemas';
import { toScheduleRows } from './pelican-schedule-rows.helpers';
import { PELICAN_SCHEDULE_NAME_MAX } from './pelican.constants';
import { loadPelicanFixture } from './testing/pelican-fixtures';

const SENTINEL = 'SENTINEL_PAYLOAD_1773';

function fixtureSchedules(): PelicanSchedule[] {
  return PelicanScheduleListSchema.parse(
    loadPelicanFixture('server-schedules'),
  );
}

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function taskOf(overrides: Partial<PelicanTask>): PelicanTask {
  return {
    id: 1,
    sequence_id: 1,
    action: 'command',
    payload: SENTINEL,
    time_offset: 0,
    is_queued: false,
    continue_on_failure: false,
    ...overrides,
  };
}

function scheduleOf(
  id: number,
  tasks: PelicanTask[],
  overrides: Partial<PelicanSchedule> = {},
): PelicanSchedule {
  const base = must(fixtureSchedules()[0], 'fixture schedule');
  return { ...base, id, name: `Schedule ${id}`, tasks, ...overrides };
}

describe('toScheduleRows — mapping', () => {
  it('maps the fixture to exactly the stored columns', () => {
    const { rows, skipped } = toScheduleRows(7, fixtureSchedules());
    expect(skipped).toBe(0);
    expect(rows).toEqual([
      {
        serverId: 7,
        panelScheduleId: 1,
        name: 'Nightly restart',
        cronMinute: '0',
        cronHour: '4',
        cronDayOfMonth: '*',
        cronMonth: '*',
        cronDayOfWeek: '*',
        isActive: true,
        onlyWhenOnline: false,
        nextRunAt: new Date('2026-01-02T04:00:00Z'),
        lastRunAt: new Date('2026-01-01T04:00:00Z'),
        effect: 'restart',
        effectOffsetS: 0,
      },
      {
        serverId: 7,
        panelScheduleId: 2,
        name: 'Weekend announcement',
        cronMinute: '30',
        cronHour: '18',
        cronDayOfMonth: '*',
        cronMonth: '*',
        cronDayOfWeek: '6',
        isActive: false,
        onlyWhenOnline: true,
        nextRunAt: null,
        lastRunAt: null,
        effect: 'command',
        effectOffsetS: 0,
      },
    ]);
  });
});

describe('toScheduleRows — payloads, skips, duplicates', () => {
  it('never carries a command payload into any row', () => {
    const schedules = [
      scheduleOf(1, [taskOf({ payload: SENTINEL })]),
      scheduleOf(2, [
        taskOf({ id: 2, payload: `say ${SENTINEL}` }),
        taskOf({ id: 3, sequence_id: 2, action: 'power', payload: 'restart' }),
      ]),
    ];
    const { rows } = toScheduleRows(1, schedules);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(SENTINEL);
    expect(JSON.stringify(rows)).not.toContain('payload');
  });

  it('skips and counts schedules without tasks', () => {
    const { rows, skipped } = toScheduleRows(1, [
      scheduleOf(1, []),
      scheduleOf(2, [taskOf({ action: 'backup', payload: null })]),
    ]);
    expect(skipped).toBe(1);
    expect(rows.map((r) => [r.panelScheduleId, r.effect])).toEqual([
      [2, 'backup'],
    ]);
  });

  it('keeps the last of duplicate panel schedule ids', () => {
    const { rows } = toScheduleRows(1, [
      scheduleOf(5, [taskOf({ action: 'backup', payload: null })], {
        name: 'first',
      }),
      scheduleOf(5, [taskOf({ action: 'power', payload: 'stop' })], {
        name: 'second',
      }),
    ]);
    expect(rows.map((r) => [r.panelScheduleId, r.name, r.effect])).toEqual([
      [5, 'second', 'stop'],
    ]);
  });
});

describe('toScheduleRows — field normalisation', () => {
  it(`truncates names to ${PELICAN_SCHEDULE_NAME_MAX} characters`, () => {
    const long = 'x'.repeat(PELICAN_SCHEDULE_NAME_MAX + 50);
    const { rows } = toScheduleRows(1, [
      scheduleOf(1, [taskOf({})], { name: long }),
    ]);
    expect(rows[0]?.name).toHaveLength(PELICAN_SCHEDULE_NAME_MAX);
  });

  it('stores an unparseable run timestamp as null', () => {
    const { rows } = toScheduleRows(1, [
      scheduleOf(1, [taskOf({})], {
        next_run_at: 'not-a-date',
        last_run_at: '',
      }),
    ]);
    expect(rows[0]?.nextRunAt).toBeNull();
    expect(rows[0]?.lastRunAt).toBeNull();
  });

  it('stores the cumulative offset of the deriving task', () => {
    const { rows } = toScheduleRows(1, [
      scheduleOf(1, [
        taskOf({ id: 1, sequence_id: 1, time_offset: 600 }),
        taskOf({ id: 2, sequence_id: 2, time_offset: 600 }),
        taskOf({
          id: 3,
          sequence_id: 3,
          action: 'power',
          payload: 'stop',
          time_offset: 600,
        }),
      ]),
    ]);
    expect(rows[0]?.effectOffsetS).toBe(1800);
  });
});

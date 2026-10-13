import {
  deriveScheduleEffect,
  type DerivedEffect,
  type ScheduleTaskInput,
} from './pelican-schedule-effect.helpers';

let nextId = 1;
function task(
  action: string,
  payload: string | null,
  timeOffset: number,
  sequenceId?: number,
): ScheduleTaskInput {
  const id = nextId++;
  return {
    id,
    sequence_id: sequenceId ?? id,
    action,
    payload,
    time_offset: timeOffset,
  };
}

const power = (keyword: string, offset = 0, seq?: number) =>
  task('power', keyword, offset, seq);

const cases: [string, ScheduleTaskInput[], DerivedEffect | null][] = [
  ['power start', [power('start', 15)], { effect: 'start', effectOffsetS: 15 }],
  [
    'power restart',
    [power('restart', 30)],
    { effect: 'restart', effectOffsetS: 30 },
  ],
  ['power stop', [power('stop')], { effect: 'stop', effectOffsetS: 0 }],
  ['power kill', [power('kill', 900)], { effect: 'kill', effectOffsetS: 900 }],
  [
    'commands then restart: power wins at the running sum',
    [
      task('command', 'say a', 0),
      task('command', 'say b', 60),
      power('restart', 300),
    ],
    { effect: 'restart', effectOffsetS: 360 },
  ],
  [
    'stop then start: first power task wins',
    [power('stop', 0), power('start', 30)],
    { effect: 'stop', effectOffsetS: 0 },
  ],
  [
    'backups only',
    [task('backup', null, 10), task('backup', null, 20)],
    { effect: 'backup', effectOffsetS: 10 },
  ],
  [
    'commands only',
    [task('command', 'say x', 5), task('command', 'say y', 5)],
    { effect: 'command', effectOffsetS: 5 },
  ],
  [
    'command + backup',
    [task('command', 'say x', 45), task('backup', null, 0)],
    { effect: 'mixed', effectOffsetS: 45 },
  ],
  [
    'delete_files only',
    [task('delete_files', 'a.log', 12)],
    { effect: 'mixed', effectOffsetS: 12 },
  ],
  [
    'delete_files + backup',
    [task('delete_files', 'a.log', 0), task('backup', null, 0)],
    { effect: 'mixed', effectOffsetS: 0 },
  ],
  [
    'unknown action only',
    [task('wake', null, 7)],
    { effect: 'mixed', effectOffsetS: 7 },
  ],
  [
    'unknown power keyword only',
    [power('hibernate', 3)],
    { effect: 'mixed', effectOffsetS: 3 },
  ],
  [
    'backup + unknown power keyword',
    [task('backup', null, 0), power('hibernate', 0)],
    { effect: 'mixed', effectOffsetS: 0 },
  ],
  ['no tasks', [], null],
  [
    'unsorted input is sorted by sequence_id',
    [power('restart', 600, 2), power('stop', 20, 1)],
    { effect: 'stop', effectOffsetS: 20 },
  ],
  [
    'unsorted input sums offsets in sequence order',
    [
      power('restart', 100, 3),
      task('command', 'say x', 50, 1),
      task('backup', null, 25, 2),
    ],
    { effect: 'restart', effectOffsetS: 175 },
  ],
  [
    'running sum may exceed the per-task 900 s cap',
    [
      task('command', 'say a', 600),
      task('command', 'say b', 600),
      power('stop', 600),
    ],
    { effect: 'stop', effectOffsetS: 1800 },
  ],
];

describe('deriveScheduleEffect', () => {
  it.each(cases)('%s', (_label, tasks, expected) => {
    expect(deriveScheduleEffect(tasks)).toEqual(expected);
  });

  it('breaks a sequence_id tie by task id', () => {
    const later = { ...power('start', 0, 1), id: 99 };
    const earlier = { ...power('stop', 0, 1), id: 5 };
    expect(deriveScheduleEffect([later, earlier])?.effect).toBe('stop');
  });

  it('never returns the payload', () => {
    const result = deriveScheduleEffect([
      task('command', 'SENTINEL_PAYLOAD', 0),
    ]);
    expect(Object.keys(result ?? {}).sort()).toEqual([
      'effect',
      'effectOffsetS',
    ]);
    expect(JSON.stringify(result)).not.toContain('SENTINEL_PAYLOAD');
  });

  it('does not reorder the caller array', () => {
    const tasks = [power('restart', 0, 2), power('stop', 0, 1)];
    const before = tasks.map((t) => t.sequence_id);
    deriveScheduleEffect(tasks);
    expect(tasks.map((t) => t.sequence_id)).toEqual(before);
  });
});

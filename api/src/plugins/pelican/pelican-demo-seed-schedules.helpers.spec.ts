/**
 * ROK-1877 — the server-hub fixture's schedule sets: the body parser, the
 * start-only set (no stop, so the hub card shows a "Starts" line) and the
 * outside-hours window kept clear of `now` (spec S3).
 */
import {
  OUTSIDE_HOURS_LEAD_H,
  hasUnknownHubScheduleSet,
  hubServerSchedules,
  parseHubScheduleSet,
  runningServerSchedules,
} from './pelican-demo-seed-schedules.helpers';

const NOW = new Date('2026-10-23T22:30:00Z');

describe('parseHubScheduleSet', () => {
  it.each([
    [{ schedules: 'start_only' }, 'start_only'],
    [{ schedules: 'outside_hours' }, 'outside_hours'],
    [{ schedules: 'running' }, 'running'],
    [{ withSchedules: true }, 'running'],
    [{ schedules: 'start_only', withSchedules: true }, 'start_only'],
    [{ schedules: 'bogus', withSchedules: true }, 'running'],
    [{ schedules: 'bogus' }, null],
    [{ withSchedules: 'true' }, null],
    [{}, null],
    [null, null],
    ['start_only', null],
  ])('%j → %j', (body, expected) => {
    expect(parseHubScheduleSet(body)).toBe(expected);
  });
});

describe('hasUnknownHubScheduleSet (the controller 400s on it)', () => {
  it.each([
    [{ schedules: 'start-only' }, true],
    [{ schedules: 'bogus', withSchedules: true }, true],
    [{ schedules: 7 }, true],
    [{ schedules: null }, true],
    [{ schedules: 'start_only' }, false],
    [{ schedules: undefined }, false],
    [{ withSchedules: true }, false],
    [{}, false],
    [null, false],
  ])('%j → %j', (body, expected) => {
    expect(hasUnknownHubScheduleSet(body)).toBe(expected);
  });
});

describe('hubServerSchedules', () => {
  it('running = the seed-servers running set, unchanged', () => {
    expect(hubServerSchedules('running', 9, NOW)).toEqual(
      runningServerSchedules(9),
    );
  });

  it('start_only = one daily start and no stop', () => {
    const rows = hubServerSchedules('start_only', 9, NOW);
    expect(rows.map((r) => [r.effect, r.cronMinute, r.cronHour])).toEqual([
      ['start', '0', '14'],
    ]);
    expect(rows.every((r) => r.serverId === 9 && r.isActive)).toBe(true);
  });

  it(`outside_hours = a daily one-hour window ${OUTSIDE_HOURS_LEAD_H} h after now's UTC hour, wrapping midnight`, () => {
    const rows = hubServerSchedules('outside_hours', 9, NOW);
    expect(rows.map((r) => [r.effect, r.cronMinute, r.cronHour])).toEqual([
      ['start', '0', '1'],
      ['stop', '0', '2'],
    ]);
    expect(rows.map((r) => r.panelScheduleId)).toEqual([1, 2]);
  });

  it('outside_hours never contains now, at any hour of the day', () => {
    for (let h = 0; h < 24; h += 1) {
      const now = new Date(Date.UTC(2026, 9, 23, h, 59));
      const [start] = hubServerSchedules('outside_hours', 1, now);
      const startH = Number(start?.cronHour);
      const hoursAhead = (startH - h + 24) % 24;
      expect({ h, hoursAhead }).toEqual({
        h,
        hoursAhead: OUTSIDE_HOURS_LEAD_H,
      });
    }
  });
});

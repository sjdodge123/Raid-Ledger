/**
 * Demo schedules for the DEMO_MODE Pelican seed (ROK-1096 D15): a start/stop
 * window + a nightly restart on the running+mapped server — plus (ROK-1774)
 * a backup in the restart's minute (coincident markers) and a short midday
 * window (short-window label) — and one restart
 * whose stored `next_run_at` deliberately disagrees with its server's
 * timezone override so the fleet UI plan can show (and fix) the warning.
 */
import type { NewPelicanSchedule } from '../../drizzle/schema';
import { nextAtOrAfter } from './pelican-schedule-cron.helpers';

/** The override the mismatched demo server is seeded with. */
export const DEMO_TZ_MISMATCH_STORED = 'UTC';
/** The override that clears its warning — the zone `next_run_at` was computed in. */
export const DEMO_TZ_MISMATCH_FIX = 'America/New_York';

const NIGHTLY_RESTART = '0 4 * * *';
/** Cumulative seconds from the schedule firing to the restart task. */
export const DEMO_RESTART_OFFSET_S = 300;
/**
 * The backup lands 30 s after the restart: the same local minute, so the grid
 * folds both into one glyph, but later, so the restart stays the group head.
 */
export const DEMO_BACKUP_OFFSET_S = 330;

interface DemoScheduleSpec {
  name: string;
  expr: string;
  effect: string;
  effectOffsetS: number;
}

const RUNNING_SCHEDULES: readonly DemoScheduleSpec[] = [
  {
    name: 'Evening open',
    expr: '0 18 * * *',
    effect: 'start',
    effectOffsetS: 0,
  },
  { name: 'Late close', expr: '0 2 * * *', effect: 'stop', effectOffsetS: 0 },
  {
    name: 'Nightly restart',
    expr: NIGHTLY_RESTART,
    effect: 'restart',
    effectOffsetS: DEMO_RESTART_OFFSET_S,
  },
  // ROK-1774: appended after the originals so their panel ids are unchanged.
  {
    name: 'Nightly backup',
    expr: NIGHTLY_RESTART,
    effect: 'backup',
    effectOffsetS: DEMO_BACKUP_OFFSET_S,
  },
  {
    name: 'Midday open',
    expr: '0 13 * * *',
    effect: 'start',
    effectOffsetS: 0,
  },
  {
    name: 'Midday close',
    expr: '40 13 * * *',
    effect: 'stop',
    effectOffsetS: 0,
  },
];

function toRow(
  serverId: number,
  panelScheduleId: number,
  spec: DemoScheduleSpec,
  nextRunAt: Date | null,
): NewPelicanSchedule {
  const [
    cronMinute = '*',
    cronHour = '*',
    cronDayOfMonth = '*',
    cronMonth = '*',
    cronDayOfWeek = '*',
  ] = spec.expr.split(' ');
  return {
    serverId,
    panelScheduleId,
    name: spec.name,
    cronMinute,
    cronHour,
    cronDayOfMonth,
    cronMonth,
    cronDayOfWeek,
    isActive: true,
    nextRunAt,
    effect: spec.effect,
    effectOffsetS: spec.effectOffsetS,
  };
}

/**
 * Start 18:00 + stop 02:00 + restart 04:00 (+5 min) + backup 04:00 (+5.5 min)
 * + a 13:00–13:40 window, in the server's own zone.
 */
export function runningServerSchedules(serverId: number): NewPelicanSchedule[] {
  return RUNNING_SCHEDULES.map((spec, i) => toRow(serverId, i + 1, spec, null));
}

/**
 * One nightly restart whose `next_run_at` is the next 04:00 in
 * {@link DEMO_TZ_MISMATCH_FIX} — never a 04:00 in the stored UTC override.
 */
export function tzMismatchServerSchedules(
  serverId: number,
  now: Date,
): NewPelicanSchedule[] {
  const nextRunAt = nextAtOrAfter(NIGHTLY_RESTART, DEMO_TZ_MISMATCH_FIX, now);
  const spec: DemoScheduleSpec = {
    name: 'Nightly restart',
    expr: NIGHTLY_RESTART,
    effect: 'restart',
    effectOffsetS: 0,
  };
  return [toRow(serverId, 1, spec, nextRunAt)];
}

/**
 * Demo schedules for the DEMO_MODE Pelican seed (ROK-1096 D15): a start/stop
 * window + a nightly restart on the running+mapped server — plus (ROK-1774)
 * a backup in the restart's minute (coincident markers) and a short midday
 * window (short-window label) — and one nightly restart on the offline row.
 * ROK-1877 adds two opt-in server-hub sets: a start-only power schedule and a
 * window kept clear of `now` (a manual start outside the usual hours).
 * Every cron is UTC, as Pelican panel crons always are (ROK-1795).
 */
import type { NewPelicanSchedule } from '../../drizzle/schema';
import { PELICAN_CRON_TIMEZONE } from './pelican-projection.helpers';
import { nextAtOrAfter } from './pelican-schedule-cron.helpers';

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
 * + a 13:00–13:40 window, all UTC.
 */
export function runningServerSchedules(serverId: number): NewPelicanSchedule[] {
  return RUNNING_SCHEDULES.map((spec, i) => toRow(serverId, i + 1, spec, null));
}

/** One nightly restart whose `next_run_at` is the next 04:00 UTC. */
export function offlineServerSchedules(
  serverId: number,
  now: Date,
): NewPelicanSchedule[] {
  const nextRunAt = nextAtOrAfter(NIGHTLY_RESTART, PELICAN_CRON_TIMEZONE, now);
  const spec: DemoScheduleSpec = {
    name: 'Nightly restart',
    expr: NIGHTLY_RESTART,
    effect: 'restart',
    effectOffsetS: 0,
  };
  return [toRow(serverId, 1, spec, nextRunAt)];
}

/** ROK-1877: a daily 14:00 UTC start with no matching stop (spec D6 / S7). */
const START_ONLY: DemoScheduleSpec = {
  name: 'Afternoon open',
  expr: '0 14 * * *',
  effect: 'start',
  effectOffsetS: 0,
};

/** Hours from `now` to the outside-hours window's start; it lasts one hour. */
export const OUTSIDE_HOURS_LEAD_H = 3;

/**
 * A daily one-hour window starting `OUTSIDE_HOURS_LEAD_H` whole UTC hours
 * after `now`'s hour, so a running server seeded at `now` is outside it
 * (spec S3) for at least two hours, whatever the wall clock says.
 */
function outsideHoursSpecs(now: Date): DemoScheduleSpec[] {
  const startH = (now.getUTCHours() + OUTSIDE_HOURS_LEAD_H) % 24;
  const stopH = (startH + 1) % 24;
  return [
    {
      name: 'Evening open',
      expr: `0 ${startH} * * *`,
      effect: 'start',
      effectOffsetS: 0,
    },
    {
      name: 'Evening close',
      expr: `0 ${stopH} * * *`,
      effect: 'stop',
      effectOffsetS: 0,
    },
  ];
}

/** The server-hub fixture's schedule sets (`running` = the seed-servers set). */
export type HubScheduleSet = 'running' | 'start_only' | 'outside_hours';
const HUB_SCHEDULE_SETS: readonly HubScheduleSet[] = [
  'running',
  'start_only',
  'outside_hours',
];

function isHubScheduleSet(v: unknown): v is HubScheduleSet {
  return HUB_SCHEDULE_SETS.some((s) => s === v);
}

/**
 * The set from an untrusted body: `{ schedules: '<set>' }` wins, else
 * ROK-1876's `{ withSchedules: true }` = `running`; anything else = none.
 */
export function parseHubScheduleSet(body: unknown): HubScheduleSet | null {
  if (typeof body !== 'object' || body === null) return null;
  if ('schedules' in body && isHubScheduleSet(body.schedules)) {
    return body.schedules;
  }
  const legacy = 'withSchedules' in body && body.withSchedules === true;
  return legacy ? 'running' : null;
}

/** The schedule rows for one server-hub fixture set. */
export function hubServerSchedules(
  set: HubScheduleSet,
  serverId: number,
  now: Date,
): NewPelicanSchedule[] {
  if (set === 'running') return runningServerSchedules(serverId);
  const specs = set === 'start_only' ? [START_ONLY] : outsideHoursSpecs(now);
  return specs.map((spec, i) => toRow(serverId, i + 1, spec, null));
}

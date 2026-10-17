import type { NewPelicanSchedule } from '../../drizzle/schema/pelican-schedules';
import type { PelicanSchedule } from './pelican-api.schemas';
import { PELICAN_SCHEDULE_NAME_MAX } from './pelican.constants';
import { deriveScheduleEffect } from './pelican-schedule-effect.helpers';

export interface ScheduleRowsResult {
  rows: NewPelicanSchedule[];
  /** Schedules not stored because they have no tasks (ROK-1773 D10). */
  skipped: number;
}

/** An upstream timestamp, or `null` when absent or unparseable (D11). */
function toDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Duplicate panel ids in one response: the last one wins (D6). */
function dedupeById(schedules: readonly PelicanSchedule[]): PelicanSchedule[] {
  const byId = new Map<number, PelicanSchedule>();
  for (const s of schedules) byId.set(s.id, s);
  return [...byId.values()];
}

/**
 * Build one row from NAMED fields only — never a spread of the upstream
 * object — so a task payload (console command) can never reach the DB.
 */
function toRow(
  serverId: number,
  s: PelicanSchedule,
  effect: NonNullable<ReturnType<typeof deriveScheduleEffect>>,
): NewPelicanSchedule {
  return {
    serverId,
    panelScheduleId: s.id,
    name: s.name.slice(0, PELICAN_SCHEDULE_NAME_MAX),
    cronMinute: s.cron.minute,
    cronHour: s.cron.hour,
    cronDayOfMonth: s.cron.day_of_month,
    cronMonth: s.cron.month,
    cronDayOfWeek: s.cron.day_of_week,
    isActive: s.is_active,
    onlyWhenOnline: s.only_when_online,
    nextRunAt: toDate(s.next_run_at),
    lastRunAt: toDate(s.last_run_at),
    effect: effect.effect,
    effectOffsetS: effect.effectOffsetS,
  };
}

/**
 * Map a server's parsed schedule list to `pelican_schedules` insert rows
 * (ROK-1773 D10/D11). Task-less schedules are skipped and counted.
 */
export function toScheduleRows(
  serverId: number,
  schedules: readonly PelicanSchedule[],
): ScheduleRowsResult {
  const rows: NewPelicanSchedule[] = [];
  let skipped = 0;
  for (const schedule of dedupeById(schedules)) {
    const effect = deriveScheduleEffect(schedule.tasks);
    if (effect === null) skipped += 1;
    else rows.push(toRow(serverId, schedule, effect));
  }
  return { rows, skipped };
}

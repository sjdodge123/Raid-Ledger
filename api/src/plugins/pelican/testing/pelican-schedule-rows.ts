import type { PelicanServableSchedule } from '../pelican-schedules.repository';

/** "m h dom mon dow" → the five stored cron columns. */
export function cronColumns(expr: string) {
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

let nextId = 1;

/** A servable stored schedule (ROK-1096 unit specs); override anything. */
export function servableSchedule(
  expr: string,
  effect: string,
  over: Partial<PelicanServableSchedule> = {},
): PelicanServableSchedule {
  const id = nextId++;
  return {
    id,
    serverId: 1,
    panelScheduleId: id,
    name: '',
    ...cronColumns(expr),
    isActive: true,
    onlyWhenOnline: false,
    nextRunAt: null,
    lastRunAt: null,
    effect,
    effectOffsetS: 0,
    gameId: 7,
    serverName: 'Valheim',
    serverTimezone: 'UTC',
    ...over,
  };
}

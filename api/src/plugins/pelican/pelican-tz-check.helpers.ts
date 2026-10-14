import { PELICAN_TZ_TOLERANCE_MS } from './pelican.constants';
import {
  isOccurrence,
  toCronExpression,
  type CronFields,
} from './pelican-schedule-cron.helpers';

/** What the tz self-check reads from a stored schedule. */
export interface TzCheckSchedule extends CronFields {
  isActive: boolean;
  nextRunAt: Date | null;
}

/**
 * ROK-1096 D10 / ruling 4: a server's timezone is wrong when an ACTIVE
 * schedule's stored `next_run_at` is not a run time of its cron in `tz`
 * (± 60 s). Inconclusive inputs — no active schedule with a `nextRunAt`, an
 * expression cron-parser rejects, a zone it cannot use — never flag.
 */
export function hasTzMismatch(
  schedules: readonly TzCheckSchedule[],
  tz: string,
): boolean {
  return schedules.some(
    (s) => s.isActive && s.nextRunAt !== null && !runsAt(s, s.nextRunAt, tz),
  );
}

function runsAt(s: CronFields, at: Date, tz: string): boolean {
  try {
    return isOccurrence(toCronExpression(s), tz, at, PELICAN_TZ_TOLERANCE_MS);
  } catch {
    return true;
  }
}

/**
 * Utility for generating recurring event dates.
 * Extracted from EventsService for testability (ROK-422).
 */

/** Maximum number of recurring instances to prevent runaway generation. */
export const MAX_RECURRENCE_INSTANCES = 52;

/**
 * Generate recurring date instances from a start date.
 *
 * - Weekly/biweekly: adds 7/14 days (stable across months).
 * - Monthly: uses calendar-month addition (setMonth), clamping to the
 *   last day of the target month when the source day doesn't exist
 *   (e.g. Jan 31 -> Feb 28).
 * - Capped at MAX_RECURRENCE_INSTANCES to prevent unbounded generation.
 *
 * @param start     - First occurrence (included in output)
 * @param frequency - 'weekly' | 'biweekly' | 'monthly'
 * @param until     - Last allowed date (inclusive upper bound)
 * @returns Array of Date instances, starting with `start`
 */
export function generateRecurringDates(
  start: Date,
  frequency: 'weekly' | 'biweekly' | 'monthly',
  until: Date,
): Date[] {
  const dates: Date[] = [new Date(start)];
  const originalDay = start.getUTCDate();
  let current = new Date(start);

  while (dates.length < MAX_RECURRENCE_INSTANCES) {
    const next = computeNextDate(current, frequency, originalDay);
    if (next > until) break;
    dates.push(next);
    current = next;
  }

  return dates;
}

function computeNextDate(
  current: Date,
  frequency: 'weekly' | 'biweekly' | 'monthly',
  originalDay: number,
): Date {
  if (frequency === 'weekly') {
    const next = new Date(current);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (frequency === 'biweekly') {
    const next = new Date(current);
    next.setUTCDate(next.getUTCDate() + 14);
    return next;
  }
  return computeMonthlyNext(current, originalDay);
}

/**
 * Advance by one calendar month, clamping to the last day of the target
 * month when the source day doesn't exist (e.g. Jan 31 -> Feb 28).
 * Restores the original day when possible to prevent drift.
 */
function computeMonthlyNext(current: Date, originalDay: number): Date {
  const next = new Date(current);
  next.setUTCMonth(next.getUTCMonth() + 1);

  const intendedMonth = (current.getUTCMonth() + 1) % 12;
  if (next.getUTCMonth() !== intendedMonth) {
    next.setUTCDate(0);
  }

  if (next.getUTCDate() !== originalDay) {
    const testDate = new Date(next);
    testDate.setUTCDate(originalDay);
    if (testDate.getUTCMonth() === next.getUTCMonth()) {
      next.setUTCDate(originalDay);
    }
  }
  return next;
}

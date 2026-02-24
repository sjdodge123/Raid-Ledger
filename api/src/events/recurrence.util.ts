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
    let next: Date;

    if (frequency === 'weekly') {
      next = new Date(current);
      next.setUTCDate(next.getUTCDate() + 7);
    } else if (frequency === 'biweekly') {
      next = new Date(current);
      next.setUTCDate(next.getUTCDate() + 14);
    } else {
      // Monthly: advance by one calendar month from the *original* day.
      // This prevents drift (e.g. Jan 31 -> Feb 28 -> Mar 28 instead of Mar 31).
      next = new Date(current);
      next.setUTCMonth(next.getUTCMonth() + 1);

      // Clamp: if the day overflowed (e.g. 31 -> Mar 3), roll back to
      // the last day of the intended month.
      const intendedMonth = (current.getUTCMonth() + 1) % 12;
      if (next.getUTCMonth() !== intendedMonth) {
        // Overflowed — set to day 0 of next.getUTCMonth() which gives the
        // last day of the intended month.
        next.setUTCDate(0);
      }

      // Restore the original day if the target month can hold it,
      // to prevent drift from clamped months (e.g. Jan 31 -> Feb 28 -> Mar 31).
      if (next.getUTCDate() !== originalDay) {
        const testDate = new Date(next);
        testDate.setUTCDate(originalDay);
        // Only restore if it didn't overflow to the next month
        if (testDate.getUTCMonth() === next.getUTCMonth()) {
          next.setUTCDate(originalDay);
        }
      }
    }

    if (next > until) break;
    dates.push(next);
    current = next;
  }

  return dates;
}

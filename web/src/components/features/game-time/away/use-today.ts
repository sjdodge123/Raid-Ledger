/**
 * The viewer's local "today" (ROK-1585 review nit).
 *
 * Read on every render and keyed on the calendar date, so a drawer or panel
 * left open past midnight picks up the new day on its next render while the
 * returned `Date` stays referentially stable within a day (safe as a memo dep).
 */
import { useMemo } from 'react';

/** Local midnight of the current calendar day; a new object only when the date changes. */
export function useToday(): Date {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    return useMemo(() => new Date(y, m, d), [y, m, d]);
}

/**
 * ROK-1598 (Codex r8): RRULE shapes whose expansion cost the iteration cap
 * cannot bound. ical.js's `next()` scans candidate instants one FREQ unit at
 * a time until one passes every limiting BY-part, synchronously and without
 * a limit of its own — `FREQ=SECONDLY;BYMONTH=1;BYMONTHDAY=1` scans a year of
 * seconds per call and `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30` never returns.
 * A counter around `next()` cannot interrupt that, so such a series is
 * refused before its iterator is built (counted in `skipped`).
 *
 * Refused: a sub-daily FREQ with any limiting BY-part (RFC 5545 §3.3.10
 * table: only the finer BYMINUTE / BYSECOND expand), a DAILY rule with
 * BYMONTHDAY / BYYEARDAY / BYWEEKNO / BYSETPOS (impossible combinations
 * never match), and a DAILY rule limited by BYMONTH / BYDAY whose DTSTART is
 * more than MAX_LIMITED_DAILY_DAYS before the window ends (one internal step
 * per elapsed day). Apple Calendar emits none of these.
 */
import ICAL from 'ical.js';
import { DAY_MS } from './apple-ical-time.helpers';

/** Expanding (cheap) BY-parts per sub-daily FREQ; every other part limits. */
const SUB_DAILY_EXPANDING: Readonly<Record<string, readonly string[]>> = {
  SECONDLY: [],
  MINUTELY: ['BYSECOND'],
  HOURLY: ['BYMINUTE', 'BYSECOND'],
};

const DAILY_REFUSED = ['BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYSETPOS'];
const DAILY_LIMITING = ['BYMONTH', 'BYDAY'];

/** ~274 years of daily steps (~0.5 s in ical.js). */
export const MAX_LIMITED_DAILY_DAYS = 100_000;

function partsOf(recur: ICAL.Recur): string[] {
  return Object.entries(recur.parts)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
}

function isCostly(recur: ICAL.Recur, elapsedDays: number): boolean {
  const parts = partsOf(recur);
  const expanding = SUB_DAILY_EXPANDING[recur.freq];
  if (expanding) return parts.some((p) => !expanding.includes(p));
  if (recur.freq !== 'DAILY') return false;
  if (parts.some((p) => DAILY_REFUSED.includes(p))) return true;
  const limited = parts.some((p) => DAILY_LIMITING.includes(p));
  return limited && elapsedDays > MAX_LIMITED_DAILY_DAYS;
}

/** True when any of the master's RRULEs cannot be expanded in bounded time. */
export function isCostlyRule(master: ICAL.Component, rangeEnd: Date): boolean {
  const start: unknown = master.getFirstPropertyValue('dtstart');
  const startMs = start instanceof ICAL.Time ? start.toUnixTime() * 1000 : 0;
  const elapsedDays = (rangeEnd.getTime() - startMs) / DAY_MS;
  return master.getAllProperties('rrule').some((prop) => {
    const recur: unknown = prop.getFirstValue();
    return recur instanceof ICAL.Recur && isCostly(recur, elapsedDays);
  });
}

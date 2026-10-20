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
 *
 * Codex r9: also refused — a DAILY BYDAY no step can reach (an INTERVAL that
 * is a multiple of 7 only revisits DTSTART's weekday; an ordinal such as
 * `1TU` never equals the bare weekday ical.js compares), and WEEKLY with
 * BYWEEKNO (ical.js jumps a year per step, so `BYWEEKNO=1;BYMONTH=6` never
 * matches). WEEKLY's BYMONTHDAY / BYYEARDAY are ignored by ical.js (illegal
 * for WEEKLY), so they cannot trap it.
 *
 * Codex r10: also refused — an INTERVAL above `MAX_INTERVAL[FREQ]`. ical.js
 * adds a day-based step one day at a time (`increment_monthday` loops
 * INTERVAL times for DAILY, 7·INTERVAL for WEEKLY, and the sub-daily FREQs
 * carry into it), eagerly, before the first occurrence is returned —
 * `FREQ=DAILY;INTERVAL=100000000` spends ~17 s inside the first `next()`.
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
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * Largest INTERVAL kept per FREQ. Day-based FREQs stop at about a year per
 * step (366 days in each FREQ's unit; WEEKLY 53), so one step costs at most
 * ~366 day-loop turns. MONTHLY / YEARLY add INTERVAL arithmetically (O(1))
 * — their century ceilings are defensive only. Every real calendar rule fits.
 */
export const MAX_INTERVAL: Readonly<Record<string, number>> = {
  SECONDLY: 366 * 86_400,
  MINUTELY: 366 * 1_440,
  HOURLY: 366 * 24,
  DAILY: 366,
  WEEKLY: 53,
  MONTHLY: 1_200,
  YEARLY: 100,
};

/** ~274 years of daily steps (~0.5 s in ical.js). */
export const MAX_LIMITED_DAILY_DAYS = 100_000;

function partsOf(recur: ICAL.Recur): string[] {
  return Object.entries(recur.parts)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
}

/** What the cost check needs to know about the series' DTSTART. */
interface StartFacts {
  elapsedDays: number;
  /** DTSTART's wall-clock weekday (`SU`…`SA`), else null. */
  weekday: string | null;
}

/** Codex r9: no DAILY step from DTSTART lands on a BYDAY weekday. */
function bydayUnreachable(recur: ICAL.Recur, weekday: string | null): boolean {
  const byday = recur.parts.BYDAY;
  if (!Array.isArray(byday) || byday.length === 0) return false;
  const bare = byday.filter((d) => WEEKDAYS.includes(d));
  if (bare.length < byday.length) return true;
  if (recur.interval % 7 !== 0 || weekday === null) return false;
  return !bare.includes(weekday);
}

function isCostlyDaily(recur: ICAL.Recur, facts: StartFacts): boolean {
  const parts = partsOf(recur);
  if (parts.some((p) => DAILY_REFUSED.includes(p))) return true;
  if (bydayUnreachable(recur, facts.weekday)) return true;
  const limited = parts.some((p) => DAILY_LIMITING.includes(p));
  return limited && facts.elapsedDays > MAX_LIMITED_DAILY_DAYS;
}

function isCostly(recur: ICAL.Recur, facts: StartFacts): boolean {
  const ceiling = MAX_INTERVAL[recur.freq];
  if (ceiling !== undefined && recur.interval > ceiling) return true;
  const expanding = SUB_DAILY_EXPANDING[recur.freq];
  if (expanding) return partsOf(recur).some((p) => !expanding.includes(p));
  if (recur.freq === 'WEEKLY') return partsOf(recur).includes('BYWEEKNO');
  return recur.freq === 'DAILY' && isCostlyDaily(recur, facts);
}

function startFacts(master: ICAL.Component, rangeEnd: Date): StartFacts {
  const start: unknown = master.getFirstPropertyValue('dtstart');
  if (!(start instanceof ICAL.Time)) {
    return { elapsedDays: rangeEnd.getTime() / DAY_MS, weekday: null };
  }
  const elapsedDays = (rangeEnd.getTime() - start.toUnixTime() * 1000) / DAY_MS;
  return { elapsedDays, weekday: WEEKDAYS[start.dayOfWeek() - 1] ?? null };
}

/** True when any of the master's RRULEs cannot be expanded in bounded time. */
export function isCostlyRule(master: ICAL.Component, rangeEnd: Date): boolean {
  const facts = startFacts(master, rangeEnd);
  return master.getAllProperties('rrule').some((prop) => {
    const recur: unknown = prop.getFirstValue();
    return recur instanceof ICAL.Recur && isCostly(recur, facts);
  });
}

const SUB_DAILY = Object.keys(SUB_DAILY_EXPANDING);
/** ical.js expands a VTIMEZONE this many years past the current one. */
const TZ_COVERAGE_DAYS = 6 * 366;

/**
 * Codex r11: an observance rule ical.js expands with no step cap — every
 * transition from DTSTART to ~5 years past now, in one synchronous loop.
 */
function isCostlyObservance(obs: ICAL.Component, rangeEnd: Date): boolean {
  const horizon = new Date(
    Math.max(rangeEnd.getTime(), Date.now()) + TZ_COVERAGE_DAYS * DAY_MS,
  );
  if (isCostlyRule(obs, horizon)) return true;
  const { elapsedDays } = startFacts(obs, horizon);
  return obs.getAllProperties('rrule').some((prop) => {
    const recur: unknown = prop.getFirstValue();
    if (!(recur instanceof ICAL.Recur)) return false;
    if (SUB_DAILY.includes(recur.freq)) return true;
    return recur.freq === 'DAILY' && elapsedDays > MAX_LIMITED_DAILY_DAYS;
  });
}

/**
 * Codex r11: true when a VTIMEZONE's STANDARD / DAYLIGHT recurrences cannot
 * be expanded in bounded time (same ceilings as an event RRULE, plus no
 * sub-daily FREQ — the expansion has no iteration cap).
 */
export function isCostlyTimezone(vtz: ICAL.Component, rangeEnd: Date): boolean {
  return vtz
    .getAllSubcomponents()
    .some((obs) => isCostlyObservance(obs, rangeEnd));
}

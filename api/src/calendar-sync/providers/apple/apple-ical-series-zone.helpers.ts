/**
 * ROK-1598 (Codex r2): a series whose DTSTART names an IANA TZID with no
 * VTIMEZONE is expanded by ical.js as FLOATING wall-clock times, and ical.js
 * compares those against UNTIL / EXDATE / RDATE as if they were UTC — so a
 * daily 19:00 Asia/Tokyo series with `UNTIL=…T100000Z` lost its last day and
 * a UTC EXDATE never matched a New York occurrence.
 *
 * Before expansion every such value given as an instant (`Z`, another zone,
 * or a floating value placed by the collection zone) is rewritten to the
 * series' own wall clock, so ical.js compares like with like; the
 * occurrences it returns are converted to instants afterwards as before
 * (`timeToMs` with the series' TZID). Mutates the per-parse master in place.
 *
 * Codex r3: the overrides' RECURRENCE-ID / DTSTART / DTEND get the same
 * treatment (value moved onto the series' wall clock, TZID set to the series
 * zone, instant unchanged), so ical.js matches an override to its occurrence
 * and computes a THISANDFUTURE shift wall clock to wall clock — a weekly
 * 19:00 New York series moved to 22:00Z on Oct 27 is 23:00Z on Nov 3. With
 * a VTIMEZONE the conversion uses its rules, never an Intl lookup (Codex r6).
 * Call it AFTER the overrides have been judged on their own times.
 */
import ICAL from 'ical.js';
import {
  isRealZone,
  timeToMs,
  utcToWall,
  type FloatingZone,
} from './apple-ical-time.helpers';

interface Target {
  zone: string;
  floating: FloatingZone;
  /** The DTSTART's resolved VTIMEZONE (Codex r5), else null = floating. */
  real: ICAL.Timezone | null;
}

/** The DTSTART's IANA TZID + whether a VTIMEZONE resolved it; else null. */
function seriesTarget(
  master: ICAL.Component,
  floating: FloatingZone,
): Target | null {
  const prop = master.getFirstProperty('dtstart');
  const value = prop?.getFirstValue();
  const tzid = prop?.getParameter('tzid');
  if (!(value instanceof ICAL.Time) || value.isDate) return null;
  if (typeof tzid !== 'string' || tzid.length === 0) return null;
  if (value.zone === ICAL.Timezone.utcTimezone) return null;
  const real = isRealZone(value.zone) ? value.zone : null;
  if (!real && !utcToWall(0, tzid)) return null;
  return { zone: tzid, floating, real };
}

/** Already on the series' clock (its TZID, same resolved/floating kind). */
function onSeriesClock(
  value: ICAL.Time,
  tzid: string | null,
  target: Target,
): boolean {
  if (tzid !== target.zone || value.zone === ICAL.Timezone.utcTimezone) {
    return false;
  }
  return isRealZone(value.zone) === (target.real !== null);
}

/** One value → the series' wall clock (unchanged when already in it). */
function toSeriesWall(
  value: ICAL.Time,
  tzid: string | null,
  target: Target,
): ICAL.Time {
  if (value.isDate || onSeriesClock(value, tzid, target)) return value;
  const ms = timeToMs(value, tzid, target.floating);
  if (ms === null) return value;
  if (target.real) return inRealZone(ms, target.real);
  const wall = utcToWall(ms, target.zone);
  if (!wall) return value;
  return ICAL.Time.fromData(
    { ...wall, isDate: false },
    ICAL.Timezone.localTimezone,
  );
}

/**
 * Codex r6: an instant → the series' embedded VTIMEZONE, by that zone's own
 * rules (its TZID may be unknown to Intl, or its rules differ from tzdata).
 */
function inRealZone(ms: number, zone: ICAL.Timezone): ICAL.Time {
  const utc = new ICAL.Time();
  utc.fromUnixTime(ms / 1000);
  return utc.convertToZone(zone);
}

function tzidOf(prop: ICAL.Property): string | null {
  const raw = prop.getParameter('tzid');
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function alignDates(
  master: ICAL.Component,
  name: 'exdate' | 'rdate',
  target: Target,
): void {
  for (const prop of master.getAllProperties(name)) {
    const tzid = tzidOf(prop);
    const values: unknown[] = prop.getValues();
    prop.setValues(
      values.map((v) =>
        v instanceof ICAL.Time ? toSeriesWall(v, tzid, target) : v,
      ),
    );
  }
}

function alignUntil(master: ICAL.Component, target: Target): void {
  for (const prop of master.getAllProperties('rrule')) {
    const recur: unknown = prop.getFirstValue();
    if (!(recur instanceof ICAL.Recur) || !recur.until) continue;
    recur.until = toSeriesWall(recur.until, target.zone, target);
    prop.setValue(recur);
  }
}

const OVERRIDE_TIMES = ['recurrence-id', 'dtstart', 'dtend'] as const;

function alignOverride(override: ICAL.Component, target: Target): void {
  for (const name of OVERRIDE_TIMES) {
    const prop = override.getFirstProperty(name);
    const value = prop?.getFirstValue();
    if (!prop || !(value instanceof ICAL.Time) || value.isDate) continue;
    const wall = toSeriesWall(value, tzidOf(prop), target);
    if (wall === value) continue;
    prop.setValue(wall);
    prop.setParameter('tzid', target.zone);
  }
}

/** Rewrite UNTIL / EXDATE / RDATE + override times onto the series' clock. */
export function alignSeriesZone(
  master: ICAL.Component,
  floating: FloatingZone,
  overrides: readonly ICAL.Component[] = [],
): void {
  const target = seriesTarget(master, floating);
  if (target === null) return;
  if (target.real) {
    // ical.js compares UNTIL / EXDATE / RDATE as instants in a real zone;
    // only the THISANDFUTURE shift needs both ends on the series' clock.
    for (const o of overrides) alignOverride(o, target);
    return;
  }
  alignUntil(master, target);
  alignDates(master, 'exdate', target);
  alignDates(master, 'rdate', target);
  for (const o of overrides) alignOverride(o, target);
}

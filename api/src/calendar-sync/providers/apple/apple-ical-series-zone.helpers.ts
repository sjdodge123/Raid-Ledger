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
 */
import ICAL from 'ical.js';
import {
  isRealZone,
  timeToMs,
  utcToWall,
  type FloatingZone,
} from './apple-ical-time.helpers';

/** The DTSTART's IANA TZID when ical.js left it floating; else null. */
function unresolvedSeriesZone(master: ICAL.Component): string | null {
  const prop = master.getFirstProperty('dtstart');
  const value = prop?.getFirstValue();
  const tzid = prop?.getParameter('tzid');
  if (!(value instanceof ICAL.Time) || value.isDate) return null;
  if (typeof tzid !== 'string' || tzid.length === 0) return null;
  if (value.zone === ICAL.Timezone.utcTimezone || isRealZone(value.zone)) {
    return null;
  }
  return utcToWall(0, tzid) ? tzid : null;
}

interface Target {
  zone: string;
  floating: FloatingZone;
}

/** One value → the series' wall clock (unchanged when already in it). */
function toSeriesWall(
  value: ICAL.Time,
  tzid: string | null,
  target: Target,
): ICAL.Time {
  if (value.isDate) return value;
  const sameWall =
    tzid === target.zone &&
    value.zone !== ICAL.Timezone.utcTimezone &&
    !isRealZone(value.zone);
  if (sameWall) return value;
  const ms = timeToMs(value, tzid, target.floating);
  const wall = ms === null ? null : utcToWall(ms, target.zone);
  if (!wall) return value;
  return ICAL.Time.fromData(
    { ...wall, isDate: false },
    ICAL.Timezone.localTimezone,
  );
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

/** Rewrite UNTIL / EXDATE / RDATE onto the series' wall clock (see header). */
export function alignSeriesZone(
  master: ICAL.Component,
  floating: FloatingZone,
): void {
  const zone = unresolvedSeriesZone(master);
  if (zone === null) return;
  const target = { zone, floating };
  alignUntil(master, target);
  alignDates(master, 'exdate', target);
  alignDates(master, 'rdate', target);
}

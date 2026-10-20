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
 * Codex r7: a UTC master's EXDATE / RDATE naming an IANA TZID with no
 * VTIMEZONE (floating in ical.js) is rewritten to its UTC instant; Codex
 * r8: so are its overrides' zoned RECURRENCE-ID / DTSTART / DTEND.
 * Codex r9: a FLOATING master (no `Z`, no TZID) whose occurrences the
 * collection's `calendar-timezone` places gets the same rewrite onto its
 * floating wall clock in that zone; with no collection zone it is untouched.
 * Codex r11: an embedded-zone master's EXDATE / RDATE in another IANA zone
 * with no VTIMEZONE → its UTC instant (it was left floating).
 * Call it AFTER the overrides have been judged on their own times.
 */
import ICAL from 'ical.js';
import {
  isRealZone,
  timeToMs,
  utcToWall,
  type FloatingZone,
  type WallClock,
} from './apple-ical-time.helpers';
import { vtzWallTime } from './apple-ical-vtimezone-offset.helpers';

interface Target {
  /** The DTSTART's TZID; null = a floating master (Codex r9). */
  zone: string | null;
  floating: FloatingZone;
  /** The DTSTART's resolved VTIMEZONE (Codex r5), else null = floating. */
  real: ICAL.Timezone | null;
}

/**
 * The DTSTART's IANA TZID + whether a VTIMEZONE resolved it; a floating
 * DTSTART with a collection zone (Codex r9) → zone null; else null.
 */
function seriesTarget(
  master: ICAL.Component,
  floating: FloatingZone,
): Target | null {
  const prop = master.getFirstProperty('dtstart');
  const value = prop?.getFirstValue();
  const tzid = prop?.getParameter('tzid');
  if (!(value instanceof ICAL.Time) || value.isDate) return null;
  if (value.zone === ICAL.Timezone.utcTimezone) return null;
  if (typeof tzid !== 'string' || tzid.length === 0) {
    return floating === null ? null : { zone: null, floating, real: null };
  }
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
  const wall = wallOf(ms, target);
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
  return vtzWallTime(ms, zone);
}

/** An instant → the series' wall clock: its TZID, else the collection zone. */
function wallOf(ms: number, target: Target): WallClock | null {
  const zone = target.zone ?? target.floating;
  if (zone === null) return null;
  if (typeof zone === 'string') return utcToWall(ms, zone);
  const t = inRealZone(ms, zone);
  const { year, month, day, hour, minute, second } = t;
  return { year, month, day, hour, minute, second };
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
    if (target.zone === null) prop.removeParameter('tzid');
    else prop.setParameter('tzid', target.zone);
  }
}

function isUtcMaster(master: ICAL.Component): boolean {
  const value: unknown = master.getFirstPropertyValue('dtstart');
  return (
    value instanceof ICAL.Time &&
    !value.isDate &&
    value.zone === ICAL.Timezone.utcTimezone
  );
}

/** A floating value placed by its IANA TZID → that instant, in UTC. */
function toUtc(
  value: ICAL.Time,
  tzid: string,
  floating: FloatingZone,
): ICAL.Time {
  if (value.isDate || value.zone === ICAL.Timezone.utcTimezone) return value;
  if (isRealZone(value.zone)) return value;
  const ms = timeToMs(value, tzid, floating);
  return ms === null ? value : ICAL.Time.fromJSDate(new Date(ms), true);
}

/** Codex r7: a UTC master's zoned EXDATE / RDATE → UTC instants. */
function alignToUtc(master: ICAL.Component, floating: FloatingZone): void {
  for (const name of ['exdate', 'rdate'] as const) {
    for (const prop of master.getAllProperties(name)) {
      const tzid = tzidOf(prop);
      if (tzid === null) continue;
      const values: unknown[] = prop.getValues();
      prop.setValues(
        values.map((v) =>
          v instanceof ICAL.Time ? toUtc(v, tzid, floating) : v,
        ),
      );
    }
  }
}

/** A zoned value (VTIMEZONE rules, else its IANA TZID) → its UTC instant. */
function zonedToUtc(
  value: ICAL.Time,
  tzid: string,
  floating: FloatingZone,
): ICAL.Time {
  if (!isRealZone(value.zone)) return toUtc(value, tzid, floating);
  return value.convertToZone(ICAL.Timezone.utcTimezone);
}

/**
 * Codex r8: a UTC master's override RECURRENCE-ID / DTSTART / DTEND → UTC,
 * so ical.js keys the override on the occurrence it replaces.
 */
function overrideToUtc(override: ICAL.Component, floating: FloatingZone): void {
  for (const name of OVERRIDE_TIMES) {
    const prop = override.getFirstProperty(name);
    const value = prop?.getFirstValue();
    const tzid = prop ? tzidOf(prop) : null;
    if (!prop || !(value instanceof ICAL.Time) || value.isDate) continue;
    if (tzid === null) continue;
    const utc = zonedToUtc(value, tzid, floating);
    if (utc.zone !== ICAL.Timezone.utcTimezone) continue;
    prop.setValue(utc);
    prop.removeParameter('tzid');
  }
}

/** Rewrite UNTIL / EXDATE / RDATE + override times onto the series' clock. */
export function alignSeriesZone(
  master: ICAL.Component,
  floating: FloatingZone,
  overrides: readonly ICAL.Component[] = [],
): void {
  if (isUtcMaster(master)) {
    alignToUtc(master, floating);
    for (const o of overrides) overrideToUtc(o, floating);
    return;
  }
  const target = seriesTarget(master, floating);
  if (target === null) return;
  if (target.real) {
    // ical.js compares UNTIL / EXDATE / RDATE as instants in a real zone;
    // only the THISANDFUTURE shift needs both ends on the series' clock.
    // Codex r11: one naming another IANA zone with no VTIMEZONE is floating
    // in ical.js, so it becomes its UTC instant first.
    alignToUtc(master, floating);
    for (const o of overrides) alignOverride(o, target);
    return;
  }
  alignUntil(master, target);
  alignDates(master, 'exdate', target);
  alignDates(master, 'rdate', target);
  for (const o of overrides) alignOverride(o, target);
}

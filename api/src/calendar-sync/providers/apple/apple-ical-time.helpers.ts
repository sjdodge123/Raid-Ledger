/**
 * ROK-1598 §2.4 (L2): iCalendar time handling for the Apple read path.
 *
 * - `VALUE=DATE` → all-day; dates are never shifted through a zone
 *   (ROK-669 risk 5) — the block's instants are the dates' UTC midnights,
 *   exactly like `google-calendar-read.helpers.ts::toBounds`.
 * - `Z` → UTC.
 * - `TZID=X` → the VTIMEZONE of the same VCALENDAR when there is one (ical.js
 *   resolves it through `Component.getTimeZoneByID`; nothing is registered in
 *   the process-global `TimezoneService`, so one user's VTIMEZONE can never
 *   redefine a zone for another user's parse), else `X` as an IANA zone via
 *   `Intl`, else unresolvable (the caller counts it as skipped).
 * - Floating (no `Z`, no TZID) → the collection's `calendar-timezone`, else
 *   UTC (Q5).
 */
import ICAL from 'ical.js';
import { vtzOffsetAt } from './apple-ical-vtimezone-offset.helpers';

export const DAY_MS = 86_400_000;

/** How a floating time is placed: a parsed VTIMEZONE, an IANA name, or UTC. */
export type FloatingZone = ICAL.Timezone | string | null;

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * LRU of resolved zones. TZIDs come from the user's own events, so the cache
 * is bounded and an unknown zone (a miss) is never stored.
 */
export const FORMATTER_CACHE_LIMIT = 64;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const hit = formatters.get(zone);
  if (hit) {
    formatters.delete(zone);
    formatters.set(zone, hit);
    return hit;
  }
  const fmt = newFormatter(zone);
  if (!fmt) return null;
  if (formatters.size >= FORMATTER_CACHE_LIMIT) {
    const oldest = formatters.keys().next();
    if (!oldest.done) formatters.delete(oldest.value);
  }
  formatters.set(zone, fmt);
  return fmt;
}

function newFormatter(zone: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
}

/** The zone's offset (ms, local − UTC) at instant `ms`. */
function offsetAt(fmt: Intl.DateTimeFormat, ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const local = Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return local - Math.floor(ms / 1000) * 1000;
}

/** UTC ms → the wall clock in IANA `zone`; null for an unknown zone. */
export function utcToWall(ms: number, zone: string): WallClock | null {
  const fmt = formatterFor(zone);
  if (!fmt) return null;
  const local = new Date(ms + offsetAt(fmt, ms));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

function wallMs(t: WallClock): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

/**
 * Wall-clock time in IANA `zone` → UTC ms; null for an unknown zone.
 * Codex r4, RFC 5545 §3.3.5: a wall time the fall-back repeats is its FIRST
 * occurrence (Berlin 2026-10-25 02:30 → 00:30Z, not 01:30Z). One the
 * spring-forward gap skips uses the offset in force before the gap (Berlin
 * 2026-03-29 02:30 → 01:30Z, i.e. 03:30 CEST) — unchanged behaviour.
 */
export function zonedToUtc(t: WallClock, zone: string): number | null {
  const fmt = formatterFor(zone);
  if (!fmt) return null;
  const guess = wallMs(t);
  if (!Number.isFinite(guess)) return null;
  return wallToUtc(guess, (ms) => offsetAt(fmt, ms));
}

/**
 * Wall-clock ms (as if UTC) → UTC ms, given the zone's offset at an
 * instant: the first real occurrence, else (a gap) the pre-gap offset.
 */
function wallToUtc(guess: number, offset: (ms: number) => number): number {
  const before = offset(guess - DAY_MS);
  const after = offset(guess + DAY_MS);
  const real = [guess - before, guess - after].filter(
    (ms) => ms + offset(ms) === guess,
  );
  return real.length > 0 ? Math.min(...real) : guess - before;
}

/** Codex r11: a VTIMEZONE wall time, with the same DST rules as IANA. */
function vtzToUtc(t: WallClock, zone: ICAL.Timezone): number {
  return wallToUtc(wallMs(t), (ms) => vtzOffsetAt(zone, ms));
}

export function isRealZone(
  zone: ICAL.Timezone | null | undefined,
): zone is ICAL.Timezone {
  return (
    zone !== null &&
    zone !== undefined &&
    zone !== ICAL.Timezone.localTimezone &&
    zone !== ICAL.Timezone.utcTimezone
  );
}

function placeFloating(t: ICAL.Time, floating: FloatingZone): number | null {
  if (floating === null) return wallMs(t);
  if (typeof floating === 'string') return zonedToUtc(t, floating);
  return vtzToUtc(t, floating);
}

/**
 * A date-time → UTC ms. `tzid` is the property's TZID parameter (ical.js
 * drops it from occurrence clones, so the caller passes the series' one).
 */
export function timeToMs(
  t: ICAL.Time,
  tzid: string | null,
  floating: FloatingZone,
): number | null {
  if (t.zone === ICAL.Timezone.utcTimezone) return wallMs(t);
  if (isRealZone(t.zone)) return vtzToUtc(t, t.zone);
  if (tzid !== null) return zonedToUtc(t, tzid);
  return placeFloating(t, floating);
}

/** `YYYY-MM-DD` of a DATE value (no zone involved). */
export function dateOf(t: ICAL.Time): string {
  const mm = String(t.month).padStart(2, '0');
  const dd = String(t.day).padStart(2, '0');
  return `${String(t.year).padStart(4, '0')}-${mm}-${dd}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The collection's `calendar-timezone` → a FloatingZone (Q5). */
export function resolveFloatingZone(raw: string | null): FloatingZone {
  const value = raw?.trim() ?? '';
  if (!value) return null;
  if (!value.includes('BEGIN:VTIMEZONE')) {
    return formatterFor(value) ? value : null;
  }
  const root = parseIcsRoot(value);
  const vtz =
    root?.name === 'vtimezone' ? root : root?.getFirstSubcomponent('vtimezone');
  return vtz ? new ICAL.Timezone(vtz) : null;
}

/** One iCalendar text → its root component; null when it does not parse. */
export function parseIcsRoot(text: string): ICAL.Component | null {
  try {
    const jcal: unknown = ICAL.parse(text);
    return Array.isArray(jcal) ? new ICAL.Component(jcal) : null;
  } catch {
    return null;
  }
}

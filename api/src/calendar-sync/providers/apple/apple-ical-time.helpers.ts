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

export const DAY_MS = 86_400_000;

/** How a floating time is placed: a parsed VTIMEZONE, an IANA name, or UTC. */
export type FloatingZone = ICAL.Timezone | string | null;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  if (formatters.has(zone)) return formatters.get(zone) ?? null;
  let fmt: Intl.DateTimeFormat | null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
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
    fmt = null;
  }
  formatters.set(zone, fmt);
  return fmt;
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

function wallMs(t: WallClock): number {
  return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
}

/** Wall-clock time in IANA `zone` → UTC ms; null for an unknown zone. */
export function zonedToUtc(t: WallClock, zone: string): number | null {
  const fmt = formatterFor(zone);
  if (!fmt) return null;
  const guess = wallMs(t);
  const first = guess - offsetAt(fmt, guess);
  const second = guess - offsetAt(fmt, first);
  return Number.isFinite(second) ? second : null;
}

function isRealZone(zone: ICAL.Timezone | null | undefined): boolean {
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
  const placed = ICAL.Time.fromData(
    {
      year: t.year,
      month: t.month,
      day: t.day,
      hour: t.hour,
      minute: t.minute,
      second: t.second,
    },
    floating,
  );
  return placed.toUnixTime() * 1000;
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
  if (isRealZone(t.zone)) return t.toUnixTime() * 1000;
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

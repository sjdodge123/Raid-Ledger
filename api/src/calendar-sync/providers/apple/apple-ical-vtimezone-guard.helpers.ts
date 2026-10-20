/**
 * ROK-1598 (Codex r11): VTIMEZONE observances (STANDARD / DAYLIGHT) carry
 * their own RRULEs, which ical.js expands the first time it converts a time
 * in that zone — synchronously, with no cap. One whose rule cannot be
 * expanded in bounded time (`isCostlyTimezone`) is discarded BEFORE any
 * event time is read: its TZID then resolves as an IANA zone like any TZID
 * with no VTIMEZONE, else the event is unresolvable and counted in
 * `skipped` by the caller. The collection's `calendar-timezone` gets the
 * same treatment (its TZID as an IANA zone, else UTC).
 *
 * Codex r12: so is a MALFORMED one — an observance with no / a broken
 * DTSTART, TZOFFSETFROM or TZOFFSETTO, an RRULE that is not a valid recur,
 * or any rule ical.js throws on while inspecting or expanding it. One bad
 * VTIMEZONE never aborts the read of the whole calendar — including one
 * whose RRULE text makes `ICAL.parse` reject the entire object.
 */
import ICAL from 'ical.js';
import { isCostlyTimezone } from './apple-ical-recur-cost.helpers';
import {
  parseIcsRoot,
  resolveFloatingZone,
  utcToWall,
  type FloatingZone,
} from './apple-ical-time.helpers';

const FREQS: readonly string[] = [
  'SECONDLY',
  'MINUTELY',
  'HOURLY',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'YEARLY',
];

function isValidRule(value: unknown): boolean {
  return value instanceof ICAL.Recur && FREQS.includes(value.freq);
}

/** A STANDARD / DAYLIGHT with a DTSTART, both offsets and valid RRULEs. */
function isWellFormedObservance(obs: ICAL.Component): boolean {
  if (obs.name !== 'standard' && obs.name !== 'daylight') return false;
  const start: unknown = obs.getFirstPropertyValue('dtstart');
  const from: unknown = obs.getFirstPropertyValue('tzoffsetfrom');
  const to: unknown = obs.getFirstPropertyValue('tzoffsetto');
  if (!(start instanceof ICAL.Time) || start.isDate) return false;
  if (!(from instanceof ICAL.UtcOffset) || !(to instanceof ICAL.UtcOffset)) {
    return false;
  }
  return obs
    .getAllProperties('rrule')
    .every((prop) => isValidRule(prop.getFirstValue()));
}

/**
 * True when the VTIMEZONE must not be used: malformed, costly to expand, or
 * ical.js throws expanding it through the parse range (Codex r12).
 */
function isUnusableTimezone(vtz: ICAL.Component, rangeEnd: Date): boolean {
  try {
    const observances = vtz.getAllSubcomponents();
    if (observances.length === 0) return true;
    if (!observances.every(isWellFormedObservance)) return true;
    if (isCostlyTimezone(vtz, rangeEnd)) return true;
    new ICAL.Timezone(vtz)._ensureCoverage(rangeEnd.getUTCFullYear() + 1);
    return false;
  } catch {
    return true;
  }
}

const VTZ_BLOCK = /^BEGIN:VTIMEZONE\r?$[\s\S]*?^END:VTIMEZONE\r?$\n?/gim;

function parsesAlone(block: string): boolean {
  const text = `BEGIN:VCALENDAR\r\n${block.trimEnd()}\r\nEND:VCALENDAR\r\n`;
  return parseIcsRoot(text) !== null;
}

/**
 * Codex r12: one calendar object → its root; when `ICAL.parse` rejects it,
 * retried with every VTIMEZONE that does not parse on its own removed.
 */
export function parseCalendarRoot(text: string): ICAL.Component | null {
  const root = parseIcsRoot(text);
  if (root) return root;
  const stripped = text.replace(VTZ_BLOCK, (b) => (parsesAlone(b) ? b : ''));
  return stripped === text ? null : parseIcsRoot(stripped);
}

/** Remove every VTIMEZONE of `root` that is malformed or costly. */
export function dropCostlyTimezones(
  root: ICAL.Component,
  rangeEnd: Date,
): void {
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    if (isUnusableTimezone(vtz, rangeEnd)) root.removeSubcomponent(vtz);
  }
}

/** `resolveFloatingZone`, an unusable VTIMEZONE replaced by its TZID. */
export function safeFloatingZone(
  raw: string | null,
  rangeEnd: Date,
): FloatingZone {
  const zone = resolveFloatingZone(raw);
  if (zone === null && raw?.includes('BEGIN:VTIMEZONE')) {
    return ianaOrNull(/^TZID:(.+?)\r?$/im.exec(raw)?.[1]);
  }
  if (!(zone instanceof ICAL.Timezone) || !zone.component) return zone;
  if (!isUnusableTimezone(zone.component, rangeEnd)) return zone;
  return ianaOrNull(zone.component.getFirstPropertyValue('tzid'));
}

/** A TZID Intl knows, else null (UTC). */
function ianaOrNull(tzid: unknown): string | null {
  const trimmed = typeof tzid === 'string' ? tzid.trim() : '';
  return trimmed && utcToWall(0, trimmed) ? trimmed : null;
}

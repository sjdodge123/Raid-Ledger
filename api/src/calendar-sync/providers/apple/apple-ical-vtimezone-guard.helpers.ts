/**
 * ROK-1598 (Codex r11): VTIMEZONE observances (STANDARD / DAYLIGHT) carry
 * their own RRULEs, which ical.js expands the first time it converts a time
 * in that zone — synchronously, with no cap. One whose rule cannot be
 * expanded in bounded time (`isCostlyTimezone`) is discarded BEFORE any
 * event time is read: its TZID then resolves as an IANA zone like any TZID
 * with no VTIMEZONE, else the event is unresolvable and counted in
 * `skipped` by the caller. The collection's `calendar-timezone` gets the
 * same treatment (its TZID as an IANA zone, else UTC).
 */
import ICAL from 'ical.js';
import { isCostlyTimezone } from './apple-ical-recur-cost.helpers';
import {
  resolveFloatingZone,
  utcToWall,
  type FloatingZone,
} from './apple-ical-time.helpers';

/** Remove every VTIMEZONE of `root` whose observances are costly. */
export function dropCostlyTimezones(
  root: ICAL.Component,
  rangeEnd: Date,
): void {
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    if (isCostlyTimezone(vtz, rangeEnd)) root.removeSubcomponent(vtz);
  }
}

/** `resolveFloatingZone`, with a costly VTIMEZONE replaced by its TZID. */
export function safeFloatingZone(
  raw: string | null,
  rangeEnd: Date,
): FloatingZone {
  const zone = resolveFloatingZone(raw);
  if (!(zone instanceof ICAL.Timezone) || !zone.component) return zone;
  if (!isCostlyTimezone(zone.component, rangeEnd)) return zone;
  const tzid: unknown = zone.component.getFirstPropertyValue('tzid');
  return typeof tzid === 'string' && utcToWall(0, tzid) ? tzid : null;
}

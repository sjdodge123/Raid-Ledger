/**
 * ROK-1598 (Codex r4): how far back a `RANGE=THISANDFUTURE` override can pull
 * later occurrences. ical.js moves every occurrence after the override's
 * RECURRENCE-ID by (override DTSTART − RECURRENCE-ID); when that is negative,
 * an occurrence whose own time is past the read window can still land inside
 * it, so the expansion may only stop once an occurrence's unshifted start is
 * past the window end by at least this much. A day of slack covers a shift
 * measured on the wall clock across a DST change.
 */
import ICAL from 'ical.js';
import { DAY_MS, timeToMs, type FloatingZone } from './apple-ical-time.helpers';

function msOf(
  vevent: ICAL.Component,
  name: string,
  floating: FloatingZone,
): number | null {
  const prop = vevent.getFirstProperty(name);
  const value = prop?.getFirstValue();
  if (!prop || !(value instanceof ICAL.Time)) return null;
  const tzid = prop.getParameter('tzid');
  return timeToMs(value, typeof tzid === 'string' ? tzid : null, floating);
}

export function isThisAndFuture(override: ICAL.Component): boolean {
  const range = override
    .getFirstProperty('recurrence-id')
    ?.getParameter('range');
  return typeof range === 'string' && range.toUpperCase() === 'THISANDFUTURE';
}

/** The largest backward shift (ms) any THISANDFUTURE override applies. */
export function maxBackwardShiftMs(
  overrides: ICAL.Component[],
  floating: FloatingZone,
): number {
  let back = 0;
  for (const o of overrides) {
    if (!isThisAndFuture(o)) continue;
    const rid = msOf(o, 'recurrence-id', floating);
    const start = msOf(o, 'dtstart', floating);
    if (rid !== null && start !== null) back = Math.max(back, rid - start);
  }
  return back > 0 ? back + DAY_MS : 0;
}

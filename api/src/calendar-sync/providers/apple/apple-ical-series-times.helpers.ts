/**
 * ROK-1598 (Codex r2): the instants a master VEVENT's expansion walks —
 * ical.js's iterator (RRULE + RDATE − EXDATE) plus DTSTART for an RDATE-only
 * series, which the iterator leaves out (RFC 5545 §3.8.5.2).
 */
import ICAL from 'ical.js';
import { dateOf } from './apple-ical-time.helpers';

/** EXDATE names `t` (a DATE exdate matches its whole day). */
function excludes(master: ICAL.Component, t: ICAL.Time): boolean {
  return master.getAllProperties('exdate').some((prop) =>
    prop.getValues().some((v: unknown) => {
      if (!(v instanceof ICAL.Time)) return false;
      return v.isDate ? dateOf(v) === dateOf(t) : v.compare(t) === 0;
    }),
  );
}

/**
 * RDATE without RRULE: DTSTART is still the set's first instance
 * (RFC 5545 §3.8.5.2) but ical.js's iterator omits it (Codex r2).
 */
function initialOccurrence(master: ICAL.Component): ICAL.Time | null {
  if (master.hasProperty('rrule')) return null;
  const t: unknown = master.getFirstPropertyValue('dtstart');
  return t instanceof ICAL.Time && !excludes(master, t) ? t : null;
}

/** The iterator's times with `first` merged in order, deduplicated. */
function* seriesTimes(
  event: ICAL.Event,
  first: ICAL.Time | null,
): Generator<ICAL.Time> {
  const it = event.iterator();
  let pending = first;
  for (;;) {
    const t: ICAL.Time | null = it.next() ?? null;
    if (pending && (!t || pending.compare(t) <= 0)) {
      if (!t || pending.compare(t) < 0) yield pending;
      pending = null;
    }
    if (!t) return;
    yield t;
  }
}

/** Every time a master's expansion walks, in order. */
export function masterTimes(event: ICAL.Event): Generator<ICAL.Time> {
  return seriesTimes(event, initialOccurrence(event.component));
}

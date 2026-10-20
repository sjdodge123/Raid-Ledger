/**
 * ROK-1598 (Codex r3): `RDATE;VALUE=PERIOD` values are `ICAL.Period`s, and
 * ical.js's iterator throws on them — which dropped the whole series,
 * DTSTART included. Before expansion each period is replaced by its start
 * (a plain DATE-TIME RDATE, TZID kept) and its own end is remembered by the
 * start's instant, so that occurrence keeps the period's duration instead of
 * the series'. A value that is neither a Time nor a usable Period is dropped
 * on its own; the rest of the series still expands. Mutates the per-parse
 * master in place.
 */
import ICAL from 'ical.js';
import { timeToMs, type FloatingZone } from './apple-ical-time.helpers';

/** Start instant (ms) → that period occurrence's end instant (ms). */
export type PeriodEnds = Map<number, number>;

function tzidOf(prop: ICAL.Property): string | null {
  const raw = prop.getParameter('tzid');
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** One RDATE value → its start Time (recording a period's end), or null. */
function startOf(
  value: unknown,
  tzid: string | null,
  floating: FloatingZone,
  ends: PeriodEnds,
): ICAL.Time | null {
  if (value instanceof ICAL.Time) return value;
  if (!(value instanceof ICAL.Period) || !value.start) return null;
  const startMs = timeToMs(value.start, tzid, floating);
  const endMs = timeToMs(value.getEnd(), tzid, floating);
  if (startMs === null || endMs === null) return null;
  if (endMs > startMs) ends.set(startMs, endMs);
  return value.start;
}

/** Rewrite period RDATEs to their starts; returns each period's end. */
export function normalizePeriodRdates(
  master: ICAL.Component,
  floating: FloatingZone,
): PeriodEnds {
  const ends: PeriodEnds = new Map();
  for (const prop of master.getAllProperties('rdate')) {
    const values: unknown[] = prop.getValues();
    if (!values.some((v) => !(v instanceof ICAL.Time))) continue;
    const tzid = tzidOf(prop);
    const starts = values
      .map((v) => startOf(v, tzid, floating, ends))
      .filter((t): t is ICAL.Time => t !== null);
    prop.resetType(starts.some((t) => t.isDate) ? 'date' : 'date-time');
    prop.removeParameter('value');
    if (starts.length === 0) master.removeProperty(prop);
    else prop.setValues(starts);
  }
  return ends;
}

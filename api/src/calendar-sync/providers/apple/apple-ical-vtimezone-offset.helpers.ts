/**
 * ROK-1598 (Codex r11): an embedded VTIMEZONE's offset at an instant, read
 * from the transitions ical.js expands for it (`Timezone.changes`, UTC
 * instants sorted ascending). ical.js's own wall-clock → instant step
 * resolves a fall-back repeat to its SECOND occurrence and a spring-forward
 * gap with the offset AFTER it, and its instant → wall-clock step is an
 * hour off just after a transition; the IANA path (`zonedToUtc`) does
 * neither. Both paths go through this offset so they agree.
 */
import ICAL from 'ical.js';

interface Change {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  utcOffset: number;
  prevUtcOffset: number;
}

const CHANGE_KEYS = [
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'utcOffset',
  'prevUtcOffset',
] as const;

function isChange(value: unknown): value is Change {
  if (typeof value !== 'object' || value === null) return false;
  const fields = new Map<string, unknown>(Object.entries(value));
  return CHANGE_KEYS.every((k) => typeof fields.get(k) === 'number');
}

function changeMs(c: Change): number {
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
}

/** The VTIMEZONE's offset (ms, local − UTC) at instant `ms`. */
export function vtzOffsetAt(zone: ICAL.Timezone, ms: number): number {
  zone._ensureCoverage(new Date(ms).getUTCFullYear() + 1);
  const changes: unknown[] = zone.changes;
  let offset: number | null = null;
  for (const c of changes) {
    if (!isChange(c)) continue;
    if (changeMs(c) > ms) {
      offset ??= c.prevUtcOffset;
      break;
    }
    offset = c.utcOffset;
  }
  return (offset ?? 0) * 1000;
}

/** An instant → its wall clock in the VTIMEZONE, by that zone's rules. */
export function vtzWallTime(ms: number, zone: ICAL.Timezone): ICAL.Time {
  const local = new Date(ms + vtzOffsetAt(zone, ms));
  return ICAL.Time.fromData(
    {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
      second: local.getUTCSeconds(),
    },
    zone,
  );
}

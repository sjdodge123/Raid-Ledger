/**
 * ROK-1597 spec §3.3 (STRICT): the all-day mailbox-timezone trap. Asked for
 * UTC, Graph may hand an all-day event back either as UTC midnights or as
 * its local midnights converted to UTC (Berlin 5 Nov → `2026-11-04T23:00Z`).
 * Truncating the second shape marks the wrong day, so a date is resolved as:
 *
 * 1. an exact UTC midnight is taken as-is (the midnight shape);
 * 2. else, when `originalStartTimeZone` is an IANA name `Intl` accepts, the
 *    instant's local date in that zone (exact, covers UTC+12:45…+14);
 * 3. else (Windows zone names such as "W. Europe Standard Time") the instant
 *    is rounded to the nearest UTC midnight — exact for offsets in (−12h, +12h).
 *
 * Pure — no I/O, no logging.
 */
const DAY_MS = 86_400_000;
const GRAPH_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z)?$/;

/**
 * A Graph `dateTimeTimeZone` → epoch ms. Only UTC values are accepted (the
 * reads send `Prefer: outlook.timezone="UTC"`); anything else is null so the
 * event is dropped rather than shifted (never invent busy time).
 */
export function graphUtcInstant(value: unknown): number | null {
  const record = toRecord(value);
  if (record.timeZone !== undefined && record.timeZone !== 'UTC') return null;
  const raw = record.dateTime;
  if (typeof raw !== 'string') return null;
  const m = GRAPH_DATE_TIME.exec(raw);
  if (!m) return null;
  const fraction = (m[3] ?? '').padEnd(3, '0').slice(0, 3);
  const ms = Date.parse(`${m[1]}:${m[2] ?? '00'}.${fraction}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** The calendar date (`YYYY-MM-DD`) an all-day bound means (rules 1–3). */
export function allDayDateOf(instantMs: number, zone: unknown): string {
  if (instantMs % DAY_MS === 0) return isoDate(instantMs);
  const local = typeof zone === 'string' ? localDate(instantMs, zone) : null;
  return local ?? isoDate(Math.round(instantMs / DAY_MS) * DAY_MS);
}

/**
 * All-day start/end instants → `[first, afterLast)` UTC midnights, or null
 * when the span is degenerate after resolution (dropped, as Google does).
 */
export function allDayBounds(
  startMs: number,
  endMs: number,
  zone: unknown,
): { first: string; lastInclusive: string; start: Date; end: Date } | null {
  const first = allDayDateOf(startMs, zone);
  const after = allDayDateOf(endMs, zone);
  const firstMs = Date.parse(`${first}T00:00:00Z`);
  const afterMs = Date.parse(`${after}T00:00:00Z`);
  if (afterMs <= firstMs) return null;
  return {
    first,
    lastInclusive: isoDate(afterMs - DAY_MS),
    start: new Date(firstMs),
    end: new Date(afterMs),
  };
}

/** Local date in an IANA zone, or null for a name `Intl` rejects. */
function localDate(instantMs: number, zone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instantMs));
    const part = (type: string): string =>
      parts.find((p) => p.type === type)?.value ?? '';
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  } catch {
    return null;
  }
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value));
}

/**
 * Shared timestamp parsing helpers for postgres-js results (ROK-1206).
 *
 * `timestamp without time zone` columns are returned by postgres-js as
 * naïve strings ("YYYY-MM-DD HH:MM:SS.SSS"). The default `new Date(...)`
 * parses these in the runtime's local TZ, shifting the value by hours.
 * We INSERT JS Dates as UTC, so re-parse with an explicit UTC suffix.
 */

/**
 * Parse a postgres-js timestamp value as UTC.
 *
 * - A `Date` instance is returned as-is.
 * - A string already carrying a `Z` suffix or an explicit `±HH:MM`
 *   offset is passed straight to `new Date()`.
 * - A naïve string (space-separated, no offset) gets `T...Z` applied so
 *   it is interpreted as UTC rather than local time.
 *
 * @param value - The raw timestamp value from a postgres-js query.
 * @returns The value parsed as a UTC `Date`.
 */
export function parseTimestampUtc(value: Date | string): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  if (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}

/**
 * Shared timestamp parsing helpers for postgres-js results (ROK-1206).
 *
 * `timestamp without time zone` columns are returned by postgres-js as
 * naïve strings ("YYYY-MM-DD HH:MM:SS.SSS"). The default `new Date(...)`
 * parses these in the runtime's local TZ, shifting the value by hours.
 * We INSERT JS Dates as UTC, so re-parse with an explicit UTC suffix.
 */
import { sql, type SQL } from 'drizzle-orm';

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

/*
 * SQL fragments for zone-less `timestamp` columns (and `tsrange` bounds) that
 * hold the UTC wall clock, e.g. `events.duration` and `events.extended_until`.
 * Compared with a `timestamptz` (a `::timestamptz` param or a bare `NOW()`),
 * Postgres reads such a column in the SESSION zone, so the compare skews by
 * the session's UTC offset; read back with a bare `::text`, it prints no
 * offset and `new Date()` parses it as host-local time.
 */

/**
 * Render a zone-less UTC expression as ISO-8601 with an explicit `Z`, so
 * `new Date()` reads it as UTC whatever the host or session zone.
 *
 * @param expr - A zone-less timestamp expression (a column or range bound).
 * @returns The expression as `YYYY-MM-DDTHH:MM:SS.mmmZ` text.
 */
export function utcIsoText(expr: SQL): SQL<string> {
  return sql<string>`to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/**
 * A JS instant as the zone-less UTC wall clock, for comparing against a
 * zone-less UTC column without the session-zone skew.
 *
 * @param at - The instant to compare against.
 * @returns A zone-less `timestamp` SQL expression.
 */
export function utcWallClock(at: Date): SQL {
  return sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/** The database's current instant as the zone-less UTC wall clock. */
export const NOW_UTC: SQL = sql`(NOW() AT TIME ZONE 'UTC')`;

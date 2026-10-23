/**
 * ROK-1882 — pure play-day bucketing for Valheim skill trends.
 * A play day is the calendar date of `captured_at` in the GAME SERVER's
 * timezone (`pelican_servers.timezone`), falling back to the community
 * `default_timezone`, then UTC (operator ruling 2026-10-21).
 */

/** Play days kept per character (operator ruling 2026-10-21). */
export const SKILL_DAYS_RETAINED = 10;

/** True when `tz` is an IANA zone this runtime can format in. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Server tz → community default → UTC; an invalid zone is skipped, never thrown. */
export function resolvePlayTimezone(
  serverTz: string | null | undefined,
  defaultTz: string | null | undefined,
): string {
  if (isValidTimeZone(serverTz)) return serverTz;
  if (isValidTimeZone(defaultTz)) return defaultTz;
  return 'UTC';
}

/** The `YYYY-MM-DD` calendar date of `at` in `tz` (built from parts, no locale format). */
export function playDateIn(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

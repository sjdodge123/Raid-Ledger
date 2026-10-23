/**
 * ROK-1930 — pure helpers for recording Valheim deaths from console lines.
 */

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/** `tz`'s offset from UTC (ms) at the instant `utcMs`. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  const wall = Date.UTC(
    n('year'),
    n('month') - 1,
    n('day'),
    n('hour'),
    n('minute'),
    n('second'),
  );
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant a zone-less `yyyy-MM-ddTHH:mm:ss` wall-clock time in `tz`
 * names (spec Open question 2), or null when the string is not that shape.
 * One correction pass handles a DST edge; a skipped wall time lands on the
 * later offset.
 */
export function zonedLocalToUtc(local: string, tz: string): Date | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const n = (i: number): number => Number(m[i] ?? NaN);
  const wall = Date.UTC(n(1), n(2) - 1, n(3), n(4), n(5), n(6));
  if (Number.isNaN(wall)) return null;
  const first = wall - offsetMs(wall, tz);
  const second = wall - offsetMs(first, tz);
  return new Date(second);
}

/**
 * `occurred_at` for a log death: the stamp read in the server's play-day
 * timezone, never later than `receivedAt` (review fix round 1). The play-day
 * zone is a community setting, not the container clock — a UTC container
 * logging for an America/New_York server would otherwise date every death
 * ~4h in the future. A death cannot have happened after we read its line,
 * so a future-dated read clamps to the receive time; a past one is kept
 * (cold replays of old lines keep their real time). Unparseable → receive time.
 */
export function deathOccurredAt(
  loggedAt: string,
  tz: string,
  receivedAt: Date,
): Date {
  const zoned = zonedLocalToUtc(loggedAt, tz);
  if (zoned === null) return receivedAt;
  return zoned.getTime() > receivedAt.getTime() ? receivedAt : zoned;
}

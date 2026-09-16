/**
 * Query-string parsing for the scheduling heatmap's dated week (ROK-1570).
 *
 * The aggregate is painted for ONE concrete week, so the client tells the API
 * which week it is rendering via `?weekStart=`. Two rules keep the grid honest:
 *
 * 1. **A bad value is `undefined`, never `new Date(NaN)`.** `buildSchedulingAvailability`
 *    falls back to the current week only when the argument is `undefined`; a
 *    NaN date would be threaded into the busy-hour SQL bounds and silently
 *    return nothing. Garbage in the query string is therefore ignored, not a 400 —
 *    the heatmap is a read-only view and degrading to "this week" beats an error page.
 * 2. **Any instant is normalised to Sunday 00:00 UTC of its week.** The busy
 *    lookup trusts its `[weekStart, weekEnd)` bounds and the cells' day keys come
 *    from real UTC dates, so a mid-week instant would shift which dates map to
 *    which grid column.
 */
import { startOfWeekUtc } from './scheduling-availability.helpers';

/**
 * Parse the `weekStart` query param into the Sunday 00:00 UTC that starts its week.
 *
 * @param raw - Raw query-string value (any format `Date.parse` accepts, normally
 *   an ISO instant). Absent, empty or unparseable all yield `undefined`.
 * @returns Sunday 00:00 UTC of the parsed instant's week, or `undefined` to let
 *   the caller default to the current week.
 */
export function parseWeekStartQuery(raw?: string): Date | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return undefined;
  return startOfWeekUtc(new Date(parsed));
}

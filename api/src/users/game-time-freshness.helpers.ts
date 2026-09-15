/**
 * Shared game-time freshness rules (ROK-1560).
 *
 * The product has ONE definition of "stale game time": never confirmed, or
 * confirmed more than {@link GAME_TIME_FRESHNESS_DAYS} days ago (ROK-999).
 * It used to live only as a private method on `GameTimeService`, so the
 * scheduling-poll heatmap could not reuse it. Both now delegate here.
 */

/** Days after which a game-time confirmation is considered stale. */
export const GAME_TIME_FRESHNESS_DAYS = 7;

/** True when game time was never confirmed or is older than the freshness window. */
export function isGameTimeStale(
  confirmedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!confirmedAt) return true;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - GAME_TIME_FRESHNESS_DAYS);
  return confirmedAt < cutoff;
}

/** Whole days (floored, never negative) since confirmation; null when never confirmed. */
export function gameTimeAgeDays(
  confirmedAt: Date | null,
  now: Date = new Date(),
): number | null {
  if (!confirmedAt) return null;
  const ms = now.getTime() - confirmedAt.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

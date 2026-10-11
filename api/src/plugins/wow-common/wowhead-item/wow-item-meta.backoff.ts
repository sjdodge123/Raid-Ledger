import type { WowItemMetaInsert, WowItemMetaRow } from './wowhead-item.types';

/**
 * ROK-1756 — re-probe policy for `not_found` items. Gear item ids come from
 * unsigned export strings, so a forged id must not be re-probed against
 * Wowhead every day forever. A `not_found` row's `attempts` counts its
 * consecutive misses: daily re-probes until NOT_FOUND_MAX_MISSES, then the
 * row is parked for NOT_FOUND_PARK_MS between probes.
 */
const DAY_MS = 86_400_000;
export const NOT_FOUND_MAX_MISSES = 3;
export const NOT_FOUND_PARK_MS = 30 * DAY_MS;

/** Delay before the next probe of an item that has missed `misses` times. */
export function notFoundRetryOffsetMs(misses: number): number {
  return misses >= NOT_FOUND_MAX_MISSES ? NOT_FOUND_PARK_MS : DAY_MS;
}

/** Consecutive misses carried by a stored row (0 unless it is `not_found`). */
export function priorMisses(row: WowItemMetaRow | undefined): number {
  return row?.status === 'not_found' ? row.attempts : 0;
}

/** Consecutive errors carried by a stored row (a miss count is not one). */
export function priorErrors(row: WowItemMetaRow | undefined): number {
  return row?.status === 'not_found' ? 0 : (row?.attempts ?? 0);
}

/**
 * An `error` probe of a stored `not_found` row is neither a hit nor a miss:
 * the conflict set keeps `status = not_found`, so carry the miss count
 * through instead of overwriting it with an error count (1).
 */
export function keepMissCount(
  row: WowItemMetaInsert,
  prev: WowItemMetaRow | undefined,
): WowItemMetaInsert {
  if (row.status !== 'error' || prev?.status !== 'not_found') return row;
  return { ...row, attempts: prev.attempts };
}

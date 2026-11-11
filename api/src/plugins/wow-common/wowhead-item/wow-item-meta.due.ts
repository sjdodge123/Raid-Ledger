/**
 * ROK-1760: when a cached `wow_item_meta` row should be re-resolved.
 */
import {
  WOWHEAD_TOOLTIP_PARSE_VERSION,
  type WowItemMetaRow,
} from './wowhead-item.types';

/**
 * An `error` row is re-tried on enqueue (page view / import) once this long
 * has passed since its last attempt, even while its backoff `next_retry_at`
 * (2/4 h) is still ahead — but only for its first
 * {@link ERROR_VIEW_FLOOR_MAX_ATTEMPTS} failed runs. After that the item is
 * treated as failing for real (Wowhead outage / rate limit) and waits for its
 * hour-scale backoff. Every fetch still goes through the shared ≤1 req/s
 * limiter, and in-flight ids are never queued twice.
 */
export const ERROR_VIEW_RETRY_FLOOR_MS = 10 * 60_000;
export const ERROR_VIEW_FLOOR_MAX_ATTEMPTS = 3;

export type DueCheckRow = Pick<
  WowItemMetaRow,
  'status' | 'fetchedAt' | 'nextRetryAt' | 'attempts' | 'tooltipVersion'
>;

/** A found row whose tooltip was parsed by an older (or no) parser (ROK-2176). */
function hasStaleTooltip(row: DueCheckRow): boolean {
  const found = row.status === 'resolved' || row.status === 'classic_fallback';
  return found && row.tooltipVersion !== WOWHEAD_TOOLTIP_PARSE_VERSION;
}

/**
 * No row, a due `next_retry_at`, a found row with a stale tooltip, or a
 * young `error` row past the floor.
 */
export function isMetaDue(
  row: DueCheckRow | undefined,
  nowMs: number,
): boolean {
  if (!row) return true;
  if (row.nextRetryAt !== null && row.nextRetryAt.getTime() <= nowMs) {
    return true;
  }
  if (hasStaleTooltip(row)) return true;
  return (
    row.status === 'error' &&
    row.attempts < ERROR_VIEW_FLOOR_MAX_ATTEMPTS &&
    row.fetchedAt.getTime() + ERROR_VIEW_RETRY_FLOOR_MS <= nowMs
  );
}

/**
 * ROK-1760: when a cached `wow_item_meta` row should be re-resolved.
 */
import type { WowItemMetaRow } from './wowhead-item.types';

/**
 * An `error` row is re-tried on enqueue (page view / import) once this long
 * has passed since its last attempt, even while its backoff `next_retry_at`
 * (2/4/8 h) is still ahead. Every fetch still goes through the shared
 * ≤1 req/s limiter, and in-flight ids are never queued twice.
 */
export const ERROR_VIEW_RETRY_FLOOR_MS = 10 * 60_000;

export type DueCheckRow = Pick<
  WowItemMetaRow,
  'status' | 'fetchedAt' | 'nextRetryAt'
>;

/** No row, a due `next_retry_at`, or an `error` row past the floor. */
export function isMetaDue(row: DueCheckRow | undefined, nowMs: number): boolean {
  if (!row) return true;
  if (row.nextRetryAt !== null && row.nextRetryAt.getTime() <= nowMs) {
    return true;
  }
  return (
    row.status === 'error' &&
    row.fetchedAt.getTime() + ERROR_VIEW_RETRY_FLOOR_MS <= nowMs
  );
}

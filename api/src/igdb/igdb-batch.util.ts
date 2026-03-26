/**
 * Shared utility for parsing comma-separated batch ID query params (ROK-800).
 */

const DEFAULT_MAX_BATCH_IDS = 100;

/**
 * Parse a comma-separated ID string into an array of positive integers.
 * Filters NaN and non-positive values, caps at `max` IDs (default 100).
 */
export function parseBatchIds(
  idsParam: string | undefined,
  max = DEFAULT_MAX_BATCH_IDS,
): number[] {
  if (!idsParam) return [];
  return idsParam
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0)
    .slice(0, max);
}

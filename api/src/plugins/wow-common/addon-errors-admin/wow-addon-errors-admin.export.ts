/**
 * ROK-2099 (S3) — export row cap. The service fetches `cap + 1` rows; the
 * extra row only proves there were more, so the download is cut to `cap`
 * and the response says so in headers (the body shape stays the contract's).
 */
export const EXPORT_TRUNCATED_HEADER = 'X-Export-Truncated';
export const EXPORT_ROW_CAP_HEADER = 'X-Export-Row-Cap';

export interface CappedRows<T> {
  rows: T[];
  truncated: boolean;
}

/** `fetched` came from `limit(cap + 1)`; keep at most `cap` rows. */
export function capRows<T>(fetched: T[], cap: number): CappedRows<T> {
  const truncated = fetched.length > cap;
  return { rows: truncated ? fetched.slice(0, cap) : fetched, truncated };
}

/** Headers for a truncated export; none when every matching row fits. */
export function exportTruncationHeaders(
  truncated: boolean,
  cap: number,
): Record<string, string> {
  if (!truncated) return {};
  return {
    [EXPORT_TRUNCATED_HEADER]: 'true',
    [EXPORT_ROW_CAP_HEADER]: String(cap),
  };
}

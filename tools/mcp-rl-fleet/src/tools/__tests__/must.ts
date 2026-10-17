/**
 * Spec helper: unwrap a value that the test REQUIRES to exist (an indexed
 * mock call, a regex capture, a list element). A missing value throws with a
 * label naming what was expected, so the test fails loudly at the read instead
 * of passing on `undefined` (noUncheckedIndexedAccess).
 */
export function must<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`expected ${label} to be present, got ${String(value)}`);
  }
  return value;
}

/**
 * Narrowing helper for `noUncheckedIndexedAccess`.
 *
 * Use it ONLY where `undefined` is an impossible state: the row of a
 * single-row `.returning()`, a regex group the pattern requires, an index
 * already proven in range. It throws a descriptive `Error` — the same 500
 * class the old `TypeError` (property access on `undefined`) produced, so
 * runtime behaviour is unchanged. `null` passes through untouched.
 *
 * Where `undefined` used to flow on silently, do not use this — keep that
 * path's behaviour with an explicit check instead.
 */
export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${what} to be defined`);
  }
  return value;
}

/**
 * Narrowing helper for `noUncheckedIndexedAccess`.
 *
 * Use it ONLY where `undefined` is an impossible state: the row of a
 * single-row `.returning()`, a regex group the pattern requires, an index
 * already proven in range. It throws a descriptive `Error`. `null` passes
 * through untouched.
 *
 * Runtime behaviour is unchanged only where the old code dereferenced the
 * value: there this `Error` replaces the `TypeError` (property access on
 * `undefined`), the same 500 class. Where `undefined` used to flow on with
 * no dereference, a `defined()` call is a NEW throw — use it there only when
 * that state is unreachable, and record why; otherwise keep the old path
 * with an explicit check.
 */
export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${what} to be defined`);
  }
  return value;
}

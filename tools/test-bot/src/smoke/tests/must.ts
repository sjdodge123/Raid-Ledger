/**
 * Tiny guards for smoke specs under `noUncheckedIndexedAccess`.
 *
 * A smoke test that reads `messages[0]` or `users[3]` must FAIL with a clear
 * message when the element is missing — never pass `undefined` along and
 * never skip. These helpers throw instead.
 */

/** Return `value`, or throw `Expected <label> to be present` when it is undefined. */
export function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label} to be present, got undefined`);
  }
  return value;
}

type Tuple<T, N extends number, R extends T[] = []> = R['length'] extends N
  ? R
  : Tuple<T, N, [...R, T]>;

/**
 * Throw `message` unless `items` holds at least `n` entries. After the call,
 * `items[0]` … `items[n - 1]` are typed as defined.
 */
export function assertAtLeast<T, N extends number>(
  items: readonly T[],
  n: N,
  message: string,
): asserts items is readonly T[] & Readonly<Tuple<T, N>> {
  if (items.length < n) throw new Error(message);
}

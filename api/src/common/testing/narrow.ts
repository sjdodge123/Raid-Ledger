/**
 * Narrowing helpers for specs under `noUncheckedIndexedAccess`.
 *
 * Indexing an array yields `T | undefined`. Inside an `expect(...)` whose
 * matcher already fails on undefined, `rows[0]?.x` is enough. Everywhere else
 * (a value handed to a service or a mock, `mock.calls[0][0]` passed on, a
 * `.not.*` / toBeUndefined / toBeFalsy matcher, a regex group, a record
 * lookup) a silent `?.` could make the test vacuous, so use these instead:
 * they throw a descriptive Error the moment the value is missing.
 */
export { defined } from '../defined.helpers';
import { defined } from '../defined.helpers';

function isNonEmpty<T>(rows: readonly T[]): rows is readonly [T, ...T[]] {
  return rows.length > 0;
}

/**
 * Returns `rows` typed as having a first element, or throws when it is empty.
 * For `const [row] = nonEmpty(await db.insert(t).values(v).returning(), 'row')`.
 */
export function nonEmpty<T>(
  rows: readonly T[],
  what: string,
): readonly [T, ...T[]] {
  if (!isNonEmpty(rows)) {
    throw new Error(`Expected ${what} from a non-empty array, got []`);
  }
  return rows;
}

/**
 * Returns `items[index]` (a negative index counts from the end), or throws
 * when there is no element there. `null` elements pass through.
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
  const i = index < 0 ? items.length + index : index;
  return defined(items[i], `item at index ${index} (of ${items.length})`);
}

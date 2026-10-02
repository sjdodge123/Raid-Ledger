/**
 * Narrowing helpers for specs under `noUncheckedIndexedAccess`.
 *
 * Indexing an array (or a NodeList) yields `T | undefined`. Inside an
 * `expect(...)` whose matcher already fails on undefined, `a[0]?.b` is enough.
 * Everywhere else (a value handed to `within()`, `fireEvent`, user-event or
 * `act()`, a `.not.*` / toBeUndefined / toBeFalsy matcher, a regex group) a
 * silent `?.` could make the test vacuous, so use these instead: they throw a
 * descriptive Error the moment the value is missing.
 */

/** Returns `value`, or throws when it is `undefined`. `null` passes through. */
export function defined<T>(value: T | undefined, what = 'value'): T {
    if (value === undefined) {
        throw new Error(`expected ${what} to be defined`);
    }
    return value;
}

/**
 * Returns `items[index]` (a negative index counts from the end), or throws
 * when there is no element there.
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
    const i = index < 0 ? items.length + index : index;
    return defined(
        items[i],
        `item at index ${index} (of ${items.length})`,
    );
}

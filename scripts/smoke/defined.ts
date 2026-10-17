/**
 * Narrowing helpers for the Playwright smoke specs under
 * `noUncheckedIndexedAccess` (ROK-1161 phase 6). Mirrors
 * web/src/test/defined.ts.
 *
 * Indexing an array or a Record yields `T | undefined`. Inside an
 * `expect(...)` whose matcher already fails on undefined, `a[0]?.b` is enough.
 * Everywhere else (a locator name, a `fill()` value, an API payload, a value
 * kept for a later test) a silent `?.` could make the spec vacuous, and a bare
 * `a[0].b` turns a missing fixture into a TypeError. Use these instead: they
 * fail through Playwright's `expect(...).toBeDefined()`, so a missing value
 * reads as a test failure that names `what`.
 *
 * This module imports `@playwright/test`, so only Playwright code may import
 * it: not the modules the root-vitest helper specs load (browser-preflight.ts,
 * api-helpers.ts, auth-paths.ts, ...) and not playwright-global-setup.ts.
 */
import { expect } from '@playwright/test';

/** Returns `value`, or fails the test when it is `undefined`. `null` passes through. */
export function defined<T>(value: T | undefined, what = 'value'): T {
    expect(value, `expected ${what} to be defined`).toBeDefined();
    // Unreachable once the assertion above passed; it is what narrows the type.
    if (value === undefined) throw new Error(`expected ${what} to be defined`);
    return value;
}

/**
 * Returns `items[index]` (a negative index counts from the end), or fails the
 * test when there is no element there.
 */
export function at<T>(items: ArrayLike<T>, index: number): T {
    const i = index < 0 ? items.length + index : index;
    return defined(items[i], `item at index ${index} (of ${items.length})`);
}

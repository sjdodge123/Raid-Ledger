/**
 * Types `expect(...).toHaveNoViolations()` for vitest 5.
 *
 * vitest-axe 0.1.0's `extend-expect` augments the legacy global `Vi`
 * namespace, which vitest 5 no longer reads, so the matcher is registered at
 * runtime (src/test/setup.ts) but untyped without this module augmentation.
 */
import type { AxeMatchers } from 'vitest-axe/matchers';

declare module 'vitest' {
  // `T` must keep vitest's own parameter name and default to merge with its
  // `Assertion<T = any>` declaration, so it is unused and `any` here.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

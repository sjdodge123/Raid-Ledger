/**
 * ROK-2189: a job error rethrown ONLY so BullMQ backs off and retries it is
 * not a bug — Sentry's NestJS BullMQ integration would still capture it as an
 * unhandled error on every attempt. The thrower marks such an error and
 * `beforeSend` drops events whose original exception carries the mark. The
 * final attempt is never marked, so exhausted retries still report.
 *
 * `Symbol.for` (not a module-local WeakSet) so the mark survives a second
 * copy of this module (instrument.ts loads before Nest; jest resets modules).
 *
 * INVARIANT: the mark lives on the error INSTANCE, so a thrower must create a
 * fresh error per attempt. Never share or cache a rejected error across jobs
 * or attempts (e.g. a memoized token-refresh promise): job A's non-final
 * attempt would mark it, and job B's FINAL attempt rethrowing that same object
 * would then be dropped by Sentry.
 */
const EXPECTED_RETRY = Symbol.for('raid-ledger.sentry.expected-retry');

/**
 * Marks `err` as an expected, retry-pending failure; returns it unchanged.
 * A frozen/non-extensible error is left unmarked (it still reports) rather
 * than letting `defineProperty` throw over the job's real error.
 */
export function markExpectedRetry<T extends object>(err: T): T {
  if (!Object.isExtensible(err)) return err;
  Object.defineProperty(err, EXPECTED_RETRY, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return err;
}

/** True when `value` was marked by `markExpectedRetry`. */
export function isExpectedRetry(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, EXPECTED_RETRY) === true
  );
}

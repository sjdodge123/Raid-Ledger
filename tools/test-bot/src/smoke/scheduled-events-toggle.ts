/**
 * Process-level refcount for the Discord scheduled-events toggle (TDB:167).
 *
 * `setup.ts` turns scheduled-event creation OFF at start-up (ROK-969), so the
 * baseline, count 0, is DISABLED. Each SE test used to flip the global toggle
 * on at its start and off in its `finally`. At SMOKE_CONCURRENCY > 1 two SE
 * tests overlap, and whichever finished first turned creation off under the
 * other, whose Scheduled Event then never appeared. CI runs concurrency 1, so
 * the race bit fleet and local runs only.
 *
 * Holders now acquire and release instead. The 0→1 acquire enables and the
 * 1→0 release disables. Every transition runs through ONE promise chain, so
 * two concurrent acquires share a single enable (the second resolves only once
 * that enable has landed), and an acquire that arrives while a disable is in
 * flight re-enables after it.
 *
 * The counter is module-level: it covers every test category running in the
 * same smoke process.
 */
import type { ApiClient } from './api.js';
import { disableScheduledEvents, enableScheduledEvents } from './fixtures.js';

export interface ToggleOps<A> {
  enable: (arg: A) => Promise<void>;
  disable: (arg: A) => Promise<void>;
}

export interface ToggleRefcount<A> {
  /** Take a hold. The call that takes count 0→1 awaits `enable`. */
  acquire: (arg: A) => Promise<void>;
  /** Drop a hold. The call that takes count 1→0 awaits `disable`. */
  release: (arg: A) => Promise<void>;
  /** Holders counted by every transition that has run so far. */
  holders: () => number;
}

/**
 * Run steps strictly one after another. A step that rejects rejects only its
 * own caller; the chain carries on with the next step.
 */
function createSerialiser(): (step: () => Promise<void>) => Promise<void> {
  let tail: Promise<unknown> = Promise.resolve();
  return (step) => {
    const run = tail.then(step);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Pure refcount over an injected enable/disable pair. */
export function createToggleRefcount<A>(ops: ToggleOps<A>): ToggleRefcount<A> {
  let count = 0;
  const serialise = createSerialiser();
  const acquireStep = async (arg: A): Promise<void> => {
    count += 1;
    if (count > 1) return;
    try {
      await ops.enable(arg);
    } catch (err) {
      // A rejected acquire is not a hold: its caller never reaches the
      // `finally` that would release it. The production `enable`
      // (`enableScheduledEvents`) swallows every error today, so only an
      // injected `enable` reaches this branch; it is kept so the refcount
      // stays correct if that swallow is ever removed.
      count -= 1;
      throw err;
    }
  };
  const releaseStep = async (arg: A): Promise<void> => {
    if (count === 0) {
      console.warn('toggle refcount: release() with no holder ignored; count stays 0');
      return;
    }
    count -= 1;
    if (count === 0) await ops.disable(arg);
  };
  return {
    acquire: (arg) => serialise(() => acquireStep(arg)),
    release: (arg) => serialise(() => releaseStep(arg)),
    holders: () => count,
  };
}

const scheduledEvents = createToggleRefcount<ApiClient>({
  enable: enableScheduledEvents,
  disable: disableScheduledEvents,
});

/** Hold scheduled-event creation ON. Pair with `releaseScheduledEvents` in a `finally`. */
export function acquireScheduledEvents(api: ApiClient): Promise<void> {
  return scheduledEvents.acquire(api);
}

/** Drop a hold; the last holder turns scheduled-event creation back OFF. */
export function releaseScheduledEvents(api: ApiClient): Promise<void> {
  return scheduledEvents.release(api);
}

/**
 * `.catch()` handler for setup that runs after an acquire but before the `try`
 * whose `finally` releases it (e.g. `createEvent`). Without it a throwing setup
 * would keep its hold for the rest of the run, leaving creation ON for every
 * later non-SE test.
 */
export function releaseScheduledEventsAndRethrow(
  api: ApiClient,
): (err: unknown) => Promise<never> {
  return async (err: unknown): Promise<never> => {
    await releaseScheduledEvents(api);
    throw err;
  };
}

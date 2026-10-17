/**
 * Split the smoke suite into the parallel pool and the sequential tail.
 *
 * Kept pure and out of run.ts on purpose: run.ts calls main() at module
 * scope, so importing it from a spec would log the bot in and hit the API.
 */
import type { SmokeTest } from './types.js';

/** Categories that always run after the pool, one at a time. */
const SEQUENTIAL_CATEGORIES: ReadonlySet<SmokeTest['category']> = new Set([
  'voice',
  'cdp-command',
]);

function isSequential(t: SmokeTest): boolean {
  return SEQUENTIAL_CATEGORIES.has(t.category) || t.serial === true;
}

/**
 * Voice and CDP tests, plus any test tagged `serial` (TDB:966), run after the
 * parallel pool in their original order. Everything else joins the pool.
 */
export function partitionTests(tests: readonly SmokeTest[]): {
  parallel: SmokeTest[];
  sequential: SmokeTest[];
} {
  const parallel: SmokeTest[] = [];
  const sequential: SmokeTest[] = [];
  for (const t of tests) (isSequential(t) ? sequential : parallel).push(t);
  return { parallel, sequential };
}

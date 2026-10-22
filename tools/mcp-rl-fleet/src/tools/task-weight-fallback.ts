// No-RAM memory plan 2026-10-22, item 3 — rollout guard for `--weight medium`.
//
// The MCP loads from the operator's main checkout, so it changes the moment
// main is pulled; the VM's rl-infra changes only when the operator redeploys
// it. A VM whose task-start predates ROK-1793 S2 (#1699) rejects `medium` with
// `{"error":"invalid_weight"}` and exit 2 BEFORE it creates the task, so the
// same task id can be re-dispatched. Retrying once with `light` is exactly the
// pre-change behaviour (ungated statics), so a stale VM costs nothing.

import type { TaskWeight } from './task-weight.js';

/** True when a task-start failure is the old VM refusing an unknown weight. */
export function isInvalidWeightRejection(err: unknown): boolean {
  const stderr = (err as { stderr?: unknown } | null)?.stderr;
  return typeof stderr === 'string' && stderr.includes('"invalid_weight"');
}

/**
 * Run `dispatch(weight)`; if it throws an `invalid_weight` rejection for a
 * `medium` task, log it and retry ONCE with `light`. Any other failure — and
 * any rejection of a non-medium weight — propagates unchanged.
 *
 * @returns the dispatch result and the weight that was actually accepted.
 */
export async function dispatchWithWeightFallback<T>(
  weight: TaskWeight,
  dispatch: (w: TaskWeight) => Promise<T>,
  log: (msg: string) => void = (msg) => console.error(msg),
): Promise<{ value: T; weight: TaskWeight }> {
  try {
    return { value: await dispatch(weight), weight };
  } catch (err) {
    if (weight !== 'medium' || !isInvalidWeightRejection(err)) throw err;
    log(
      '[rl_validate_ci] VM task-start rejected weight=medium (invalid_weight: its ' +
        'rl-infra predates #1699) — retrying once with weight=light',
    );
    return { value: await dispatch('light'), weight: 'light' };
  }
}

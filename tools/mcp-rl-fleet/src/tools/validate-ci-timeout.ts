// TDB:1452 — default watchdog budget for rl_validate_ci.
//
// WHY: task-start's watchdog SIGTERMs the wrapped run at `timeout_seconds`.
// The flat 1800s default fits a --static / unit run, but a whole-gate
// `--fleet` dispatch or a Playwright tier routinely runs 40–75 minutes, so it
// was killed at 30 min with exit 143 unless the caller remembered to pass
// timeout_seconds:5400 by hand (the Lead skill does; ad-hoc callers did not).
// A BARE run (no args) or `--full` is the same trap: validate-ci.sh's default
// IS the full pipeline (unit + sharded integration, plus Playwright under
// e2e-auto on a web-surface diff), so it is long unless explicitly narrowed.
//
// LEAF module (no imports) so validate-ci.ts stays under the 300-line limit.

/** Default budget for a light / unit-scale run (30 min). */
export const DEFAULT_VALIDATE_CI_TIMEOUT_S = 1800;

/** Default budget for a whole-gate or e2e run (90 min) — operator-approved. */
export const LONG_GATE_VALIDATE_CI_TIMEOUT_S = 5400;

/** validate-ci.sh flags that always take the long-gate budget. */
const LONG_GATE_FLAGS = new Set(['--fleet', '--only-e2e', '--with-e2e']);

/**
 * validate-ci.sh flags that narrow the default full pipeline to a short run
 * (`scripts/validate-ci.sh` main()'s argv parser). `--static` defers unit,
 * integration and e2e; `--only-unit` / `--only-integration` run one suite.
 * NOT narrowing: `--full` (a no-op alias of the default), `--no-e2e` (unit +
 * integration still run), `--no-coverage`, `--ci`, `--scope=*`.
 */
const NARROWING_FLAGS = new Set(['--static', '--only-unit', '--only-integration']);

/** Watchdog bounds task-start accepts from this tool. */
const MIN_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 7200;

/**
 * Resolve the watchdog budget for one rl_validate_ci dispatch.
 *
 * @param resolvedArgs The final validate-ci.sh argv — i.e. `resolveArgs(params)`,
 *   so `fleet:true` has already been mapped onto `--fleet`.
 * @param explicit The caller's `timeout_seconds`, when given. Always wins.
 * @returns Seconds, clamped to [60, 7200]. Without an explicit value: 5400 for
 *   a whole-gate (`--fleet`), e2e (`--only-e2e` / `--with-e2e`) or un-narrowed
 *   full run (no args, `--full`, `--no-e2e`); 1800 once `--static`,
 *   `--only-unit` or `--only-integration` narrows it.
 */
export function resolveValidateCiTimeout(resolvedArgs: string[], explicit?: number): number {
  const isLongGate =
    resolvedArgs.some((a) => LONG_GATE_FLAGS.has(a)) ||
    !resolvedArgs.some((a) => NARROWING_FLAGS.has(a));
  const fallback = isLongGate ? LONG_GATE_VALIDATE_CI_TIMEOUT_S : DEFAULT_VALIDATE_CI_TIMEOUT_S;
  return Math.max(MIN_TIMEOUT_S, Math.min(MAX_TIMEOUT_S, explicit ?? fallback));
}

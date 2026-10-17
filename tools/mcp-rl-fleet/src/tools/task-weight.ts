// ROK-1470 — task weight classification for the fleet's admission gate.
//
// The VM stays at 15 GiB and the runners share it dynamically (`mem_limit: 6g`
// + `mem_reservation: 2g`, deliberately over-subscribed). What keeps that safe
// is the orchestrator's admission gate: `task-start --weight heavy` waits until
// host MemAvailable >= RL_HEAVY_TASK_MIN_FREE_MB before it launches the wrapped
// command. Light tasks are never gated.
//
// This module is the single source of truth for which MCP invocations are
// heavy BY DEFAULT. An explicit `weight` param on the tool always wins.

/** Admission weight understood by orchestrator/bin/task-start. */
export type TaskWeight = 'heavy' | 'light';

/**
 * Commands that spawn a test framework, a full CI pipeline, or a docker build.
 * The word-boundary guards are deliberate: `grep -rn jester` must stay light.
 */
const HEAVY_COMMAND_PATTERNS: RegExp[] = [
  /(^|[^a-z0-9_-])(jest|vitest|playwright)([^a-z0-9_-]|$)/i,
  /npm\s+(run\s+)?test/i,
  /validate-ci\.sh/i,
  /docker\s+build/i,
];

/** validate-ci.sh flags that mean "run a suite", not just build + tsc + lint. */
const VALIDATE_CI_HEAVY_FLAGS = [
  '--full',
  '--only-unit',
  '--only-integration',
  '--only-e2e',
  '--with-e2e',
];

/**
 * Weight for an arbitrary shell command run inside a runner (rl_run_on_runner).
 *
 * @param command - the shell command the agent asked for.
 * @param explicit - caller-supplied override; returned as-is when present.
 * @returns 'heavy' when the command runs jest/vitest/playwright/validate-ci or
 *   a docker build, otherwise 'light'.
 */
export function resolveCommandWeight(command: string, explicit?: TaskWeight): TaskWeight {
  if (explicit) return explicit;
  return HEAVY_COMMAND_PATTERNS.some((re) => re.test(command)) ? 'heavy' : 'light';
}

/**
 * Weight for a validate-ci.sh invocation (rl_validate_ci).
 *
 * Heavy by default — a bare run is the full pipeline. Only a `--static` run
 * with no forced e2e flag is light: build + typecheck + lint fit comfortably
 * alongside another heavy run.
 *
 * @param args - the fully-resolved validate-ci.sh argv (post resolveArgs).
 * @param explicit - caller-supplied override; returned as-is when present.
 */
export function resolveValidateCiWeight(args: string[], explicit?: TaskWeight): TaskWeight {
  if (explicit) return explicit;
  const hasHeavyFlag = args.some((a) => VALIDATE_CI_HEAVY_FLAGS.includes(a));
  if (hasHeavyFlag) return 'heavy';
  return args.includes('--static') ? 'light' : 'heavy';
}

/**
 * Weight for an allinone image build (rl_env_build_image_from_runner).
 * Always heavy unless the caller overrides — a docker build of the monolith is
 * the single heaviest job the fleet runs.
 */
export function resolveBuildImageWeight(explicit?: TaskWeight): TaskWeight {
  return explicit ?? 'heavy';
}

/**
 * Render the `--weight <w> ` fragment for a task-start remote command line.
 * Includes the trailing space so it concatenates like the other flag fragments.
 */
export function weightFlag(weight: TaskWeight): string {
  return `--weight ${weight} `;
}

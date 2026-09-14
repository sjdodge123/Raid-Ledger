// Fleet Playwright PASS -> the pre-push sentinel (operator ruling 2026-09-12).
//
// `.claude/settings.json` has a PreToolUse hook that DENIES `git push` when the
// branch diff touches `web/src/` unless `/tmp/.playwright-verified-<short sha>`
// exists. Until now only `/push`'s LOCAL Playwright run wrote that file — and
// the auto-mode classifier refuses to let an agent `touch` it — so agents could
// not push web branches at all and the operator pushed by hand, skipping the
// gate entirely.
//
// The fleet already runs the same suite (desktop + mobile) via rl_validate_ci.
// So: when a validate-ci task is observed TERMINAL AND its summary shows the
// Playwright STEP passed, the MCP server (which runs on the laptop, alongside
// the hook) writes the sentinel itself. A SKIPPED or FAILED Playwright tier
// never writes it, and it is only ever written for the SHA that was synced for
// THAT task — recorded at dispatch time, not re-read from a worktree that may
// have moved on since.
//
// The sentinel keys on the PLAYWRIGHT STEP, not on the script's exit code.
// `validate-ci.sh` stops at the first failing step, so a LATER tier failing
// (classically the Discord smoke tier, which needs `tools/test-bot/.env` that a
// fresh worktree does not have) drives the whole task to `failed` even though
// Playwright itself passed. The ROK-1533 lane ran four full `--only-e2e` tiers
// after its fix and got `playwright_verified: false` every time — including
// task ee580cf38f66, where Playwright reported 795 passed / 0 failed. Exit code
// answers "did the whole pipeline succeed"; the gate asks "did Playwright pass
// for this sha", and only the step answers that.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isTerminalStatus, type ExecuteStatusReturn } from './tools/task-schemas.js';
import { playwrightRowStatus, staticGateGreen } from './gate-summary.js';

/** The validate-ci.sh summary row (and orchestrator step name) we key on. */
export const PLAYWRIGHT_STEP = 'Playwright (desktop + mobile)';
/** Filename prefix the settings.json hook looks for. */
export const SENTINEL_PREFIX = '.playwright-verified-';
/** Newest N task->sha records kept; the map is bookkeeping, not history. */
const MAX_ENTRIES = 200;

/** Where the hook looks. Overridable for tests so they never touch real /tmp. */
export function sentinelDir(): string {
  return process.env.RL_PLAYWRIGHT_SENTINEL_DIR ?? '/tmp';
}

/** task_id -> synced HEAD short sha, alongside the existing laptop task state. */
export function shaMapPath(): string {
  const base = process.env.RL_FLEET_STATE_DIR ?? join(homedir(), '.raid-ledger');
  return join(base, 'validate-ci-shas.json');
}

interface ShaRecord {
  sha: string;
  recorded_at: string;
  /** ROK-1566: the web-surface diff hash the run covers, when resolvable. */
  surface?: string;
}
type ShaMap = Record<string, ShaRecord>;

function readMap(path: string): ShaMap {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as ShaMap) : {};
  } catch {
    return {};
  }
}

/**
 * Remember which worktree HEAD was synced for a dispatched validate-ci task.
 * Best-effort: a failure here only means no sentinel later, never a failed
 * dispatch.
 */
export function recordTaskSha(
  taskId: string,
  sha: string,
  path = shaMapPath(),
  surface?: string,
): void {
  if (!taskId || !sha) return;
  try {
    const map = readMap(path);
    map[taskId] = { sha, recorded_at: new Date().toISOString(), ...(surface ? { surface } : {}) };
    const kept = Object.entries(map)
      .sort((a, b) => (a[1].recorded_at < b[1].recorded_at ? 1 : -1))
      .slice(0, MAX_ENTRIES);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(kept), null, 2), { mode: 0o600 });
    renameSync(tmp, path);
  } catch {
    /* bookkeeping only — never fail the caller */
  }
}

/** The sha recorded at dispatch for this task, or null when unknown. */
export function lookupTaskSha(taskId: string, path = shaMapPath()): string | null {
  return readMap(path)[taskId]?.sha ?? null;
}

/** The web-surface hash recorded at dispatch for this task, or null (ROK-1566). */
export function lookupTaskSurfaceHash(
  taskId: string,
  path = shaMapPath(),
): string | null {
  return readMap(path)[taskId]?.surface ?? null;
}

/** Last Playwright row in a validate-ci SUMMARY block, or null when absent. */
export function playwrightSummaryStatus(logTail?: string): string | null {
  return playwrightRowStatus(logTail);
}

/**
 * Did the Playwright tier actually PASS? The SUMMARY row wins when present;
 * otherwise fall back to the orchestrator's parsed steps[]. SKIPPED is NOT a
 * Playwright pass (it may still be a STATIC pass — see `evaluateSentinel`).
 */
export function playwrightPassed(
  status: Pick<ExecuteStatusReturn, 'steps' | 'log_tail'>,
): boolean {
  const fromSummary = playwrightSummaryStatus(status.log_tail);
  if (fromSummary) return fromSummary === 'PASS';
  return (status.steps ?? []).some(
    (s) => s.name.startsWith(PLAYWRIGHT_STEP) && s.status === 'PASS',
  );
}

/** Which tier earned the sentinel. `playwright` implies the static rows too. */
export type GateTier = 'static' | 'playwright';

export interface SentinelAnnotation {
  /** Legacy alias of `gate_verified` — kept so older callers keep reading. */
  playwright_verified: boolean;
  /** Legacy alias of `gate_sentinel`. */
  playwright_sentinel: string | null;
  /** ROK-1565: was the pre-push gate satisfied, by EITHER tier? */
  gate_verified: boolean;
  /** Path of the sentinel written, or null when none was. */
  gate_sentinel: string | null;
  /** ROK-1565: which tier satisfied it, or null when none did. */
  gate_tier: GateTier | null;
  /** ROK-1566: the surface hash the sentinel is keyed to, or null when unknown. */
  surface_hash: string | null;
  /** Why no sentinel could be named, when the tier itself passed (ROK-1566). */
  surface_error?: string;
}

/**
 * Write one JSON-line sentinel per name. All-or-nothing: a partial write means
 * the push is still denied, so the caller must report NOT verified.
 */
function writeSentinels(dir: string, names: string[], body: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    for (const name of names) writeFileSync(join(dir, name), `${body}\n`);
    return true;
  } catch {
    return false;
  }
}

export interface SentinelOptions {
  /** Sentinel directory. Defaults to `sentinelDir()` (/tmp). */
  dir?: string;
  /** task->sha map path. Defaults to `shaMapPath()`. */
  mapPath?: string;
}

/** The "no sentinel" annotation, with both the new and legacy field names. */
function notVerified(surfaceHash: string | null, surfaceError?: string): SentinelAnnotation {
  return {
    playwright_verified: false,
    playwright_sentinel: null,
    gate_verified: false,
    gate_sentinel: null,
    gate_tier: null,
    surface_hash: surfaceHash,
    ...(surfaceError ? { surface_error: surfaceError } : {}),
  };
}

/**
 * Which tier (if any) this terminal status satisfies.
 *
 * ROK-1565: a green `--static` run is enough. A Playwright PASS still wins the
 * label (and still counts when a LATER tier failed the task — the ROK-1533
 * case), but a static-only run no longer has to buy a 15–25 minute Playwright
 * tier that GitHub re-runs in full before the merge anyway. A FAIL row anywhere
 * disqualifies the static tier; a cancelled/killed task disqualifies both,
 * because its log is truncated and a PASS row read there is not evidence.
 *
 * @param status - A terminal task status.
 * @returns The earning tier, or null when the gate is not satisfied.
 */
export function resolveGateTier(status: ExecuteStatusReturn): GateTier | null {
  const ran =
    status.mcp_runtime_status === 'succeeded' || status.mcp_runtime_status === 'failed';
  if (!ran) return null;
  if (playwrightPassed(status)) return 'playwright';
  const staticGreen =
    status.mcp_runtime_status === 'succeeded' && staticGateGreen(status.log_tail);
  return staticGreen ? 'static' : null;
}

/**
 * Decide + (on a pass) write the sentinel for a terminal task status.
 * Returns null when this task is not a tracked validate-ci run, or is not
 * terminal yet — the caller then annotates nothing.
 */
export function evaluateSentinel(
  status: ExecuteStatusReturn,
  opts: SentinelOptions = {},
): SentinelAnnotation | null {
  const taskId = status.task_id;
  if (!taskId) return null;
  const mapPath = opts.mapPath ?? shaMapPath();
  const sha = lookupTaskSha(taskId, mapPath);
  if (!sha) return null;
  const surface = lookupTaskSurfaceHash(taskId, mapPath);
  if (!isTerminalStatus(status.mcp_runtime_status)) return null;
  const tier = resolveGateTier(status);
  if (!tier) return notVerified(surface);
  const dir = opts.dir ?? sentinelDir();
  // ROK-1566: name the sentinel after the SURFACE the run verified, so a
  // docs-only follow-up commit (or GitHub's identical-tree "merge main"
  // rewrite) keeps a green gate. `nosurface` is never a filename — the hook
  // allows those pushes outright. The sha-named file is still written for one
  // cycle so branches gated under the old hook are not stranded.
  // An unresolvable surface is NOT a pass: the hook reads
  // .playwright-verified-<surfacehash>, so there is no name to write and
  // reporting verified:true would tell the agent a gate it is about to fail
  // was satisfied (review MAJOR 4).
  if (!surface) {
    return notVerified(
      null,
      'The gate passed but the web-surface hash was unresolved at dispatch, so no sentinel could be named. Re-run the gate from a checkout where `bash scripts/smoke/surface-hash.sh` succeeds (needs git and a resolvable origin/main).',
    );
  }
  const keyed = surface !== 'nosurface' ? surface : null;
  const names = [keyed, sha].filter((n): n is string => !!n).map((n) => `${SENTINEL_PREFIX}${n}`);
  const body = JSON.stringify({
    sha,
    surface: keyed,
    tier,
    written_at: new Date().toISOString(),
    task_id: taskId,
  });
  if (!writeSentinels(dir, names, body)) {
    // Codex P3: the hook checks for the FILE, so a failed write means the push
    // is still denied. Reporting `verified: true` here would tell the agent the
    // gate was satisfied when it was not.
    return notVerified(surface);
  }
  const written = join(dir, names[0]);
  return {
    playwright_verified: true,
    playwright_sentinel: written,
    gate_verified: true,
    gate_sentinel: written,
    gate_tier: tier,
    surface_hash: surface,
  };
}

/** Fold the sentinel outcome into a task-status result, when one applies. */
export function annotatePlaywrightSentinel<T extends ExecuteStatusReturn>(
  status: T,
  opts: SentinelOptions = {},
): T {
  const annotation = evaluateSentinel(status, opts);
  return annotation ? { ...status, ...annotation } : status;
}

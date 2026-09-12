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
// So: when a validate-ci task is observed TERMINAL + `succeeded` AND its
// summary shows the Playwright step PASSED, the MCP server (which runs on the
// laptop, alongside the hook) writes the sentinel itself. A SKIPPED or FAILED
// Playwright tier never writes it, and it is only ever written for the SHA that
// was synced for THAT task — recorded at dispatch time, not re-read from a
// worktree that may have moved on since.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isTerminalStatus, type ExecuteStatusReturn } from './tools/task-schemas.js';

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
export function recordTaskSha(taskId: string, sha: string, path = shaMapPath()): void {
  if (!taskId || !sha) return;
  try {
    const map = readMap(path);
    map[taskId] = { sha, recorded_at: new Date().toISOString() };
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

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const SUMMARY_ROW = /^Playwright \(desktop \+ mobile\)\s+(PASS|FAIL|SKIPPED)\b/gm;

/** Last Playwright row in a validate-ci SUMMARY block, or null when absent. */
export function playwrightSummaryStatus(logTail?: string): string | null {
  if (!logTail) return null;
  const clean = logTail.replace(ANSI, '');
  SUMMARY_ROW.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = SUMMARY_ROW.exec(clean)) !== null) last = match[1];
  return last;
}

/**
 * Did the Playwright tier actually PASS? The SUMMARY row wins when present;
 * otherwise fall back to the orchestrator's parsed steps[]. SKIPPED is NOT a
 * pass — that is the whole point of the gate.
 */
export function playwrightPassed(
  status: Pick<ExecuteStatusReturn, 'steps' | 'log_tail'>,
): boolean {
  const fromSummary = playwrightSummaryStatus(status.log_tail);
  if (fromSummary) return fromSummary === 'PASS';
  return (status.steps ?? []).some(
    (s) => s.name === PLAYWRIGHT_STEP && s.status === 'PASS',
  );
}

export interface SentinelAnnotation {
  playwright_verified: boolean;
  playwright_sentinel: string | null;
}

export interface SentinelOptions {
  /** Sentinel directory. Defaults to `sentinelDir()` (/tmp). */
  dir?: string;
  /** task->sha map path. Defaults to `shaMapPath()`. */
  mapPath?: string;
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
  const sha = lookupTaskSha(taskId, opts.mapPath ?? shaMapPath());
  if (!sha) return null;
  if (!isTerminalStatus(status.mcp_runtime_status)) return null;
  const verified = status.mcp_runtime_status === 'succeeded' && playwrightPassed(status);
  if (!verified) return { playwright_verified: false, playwright_sentinel: null };
  const dir = opts.dir ?? sentinelDir();
  const path = join(dir, `${SENTINEL_PREFIX}${sha}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, `${new Date().toISOString()} ${taskId}\n`);
  } catch {
    // Codex P3: the hook checks for the FILE, so a failed write means the push
    // is still denied. Reporting `verified: true` here would tell the agent the
    // gate was satisfied when it was not.
    return { playwright_verified: false, playwright_sentinel: null };
  }
  return { playwright_verified: true, playwright_sentinel: path };
}

/** Fold the sentinel outcome into a task-status result, when one applies. */
export function annotatePlaywrightSentinel<T extends ExecuteStatusReturn>(
  status: T,
  opts: SentinelOptions = {},
): T {
  const annotation = evaluateSentinel(status, opts);
  return annotation ? { ...status, ...annotation } : status;
}

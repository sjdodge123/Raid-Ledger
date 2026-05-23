import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { MAIN_REPO, PROJECT_DIR } from '../config.js';
import { shell } from '../shell.js';

// =============================================================================
// MCP wrappers around scripts/env-lock.sh — the bash script owns the logic;
// these tools just shell out and parse the JSON it emits.
// =============================================================================

const SCRIPT_PATH = resolve(MAIN_REPO ?? PROJECT_DIR, 'scripts', 'env-lock.sh');

/** Shape of the JSON the bash script always emits on stdout (subset varies by command). */
type LockState = {
  holder: HolderRecord | null;
  queue: QueueEntry[];
  free?: boolean;
  stale_cleared?: { reason: string } | null;
};

interface HolderRecord {
  branch: string;
  worktree: string;
  purpose: string;
  pid: number;
  priority: 'normal' | 'operator';
  acquired_at: string;
  heartbeat_at: string;
  ttl_minutes: number;
  preempted_from: { branch: string; worktree: string; purpose: string } | null;
  agent_id?: string;
}

interface QueueEntry {
  branch: string;
  worktree: string;
  pid: number;
  purpose: string;
  priority: 'normal' | 'operator';
  enqueued_at: string;
  preempted: boolean;
}

/**
 * Quote a shell argument safely. Single-quote wrapping with `'\''` for embedded
 * single quotes is the only escape form that's both shell-safe AND immune to
 * variable expansion (`$`, backticks). Double-quote escaping is NOT sufficient
 * — double-quoted strings still expand `$VAR`, `$(...)`, and backticks.
 */
function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Auto-detect branch via `git branch --show-current` in a given worktree. */
async function detectBranch(worktree: string): Promise<string> {
  const result = await shell(`git -C ${q(worktree)} branch --show-current`, 5_000);
  return result.stdout.trim() || 'unknown';
}

/** Sentinel string that cannot appear in any git branch name or filesystem path. */
const AGENT_ID_SEPARATOR = '|>>>|';

/**
 * Stable identity for an agent's lease, hashed from (branch, worktree). Used as
 * the primary match predicate on release / heartbeat / refresh-self so we
 * survive cwd or branch-name drift between the MCP server and the bash script
 * (e.g. deploy_dev.sh re-anchoring under a different cwd than the caller).
 *
 * Pure-deterministic SHA1 of `branch<sep>worktree`, truncated to 16 hex chars
 * (~64 bits of entropy) — collision-resistant for the small N of concurrent
 * worktrees on a single machine, short enough to fit cleanly in JSON / logs.
 * Separator is a multi-char ASCII sentinel that's invalid in git branch names
 * (which forbid `>`) and unlikely in any filesystem path, so it cannot
 * accidentally appear in either input. Avoids NUL so the source file stays
 * git-text (not binary).
 */
export function getAgentId(branch: string, worktree: string): string {
  return createHash('sha1').update(`${branch}${AGENT_ID_SEPARATOR}${worktree}`).digest('hex').slice(0, 16);
}

/** Parse JSON; on parse failure return an error envelope so MCP doesn't crash. */
function parseJson<T>(stdout: string, command: string): T | { error: string; raw: string } {
  try {
    return JSON.parse(stdout) as T;
  } catch {
    return { error: `env-lock.sh ${command} returned non-JSON`, raw: stdout };
  }
}

// ---------------------------------------------------------------------------
// env_lock_status
// ---------------------------------------------------------------------------

export const STATUS_TOOL_NAME = 'env_lock_status';
export const STATUS_TOOL_DESCRIPTION =
  'Show who holds the local dev env lease (Docker DB, API :3000, Vite :5173) and who is queued. ' +
  'Use before acquiring or before any work that needs the env.';

export async function executeStatus(): Promise<LockState | { error: string; raw: string }> {
  const result = await shell(`bash ${q(SCRIPT_PATH)} status`);
  return parseJson<LockState>(result.stdout, 'status');
}

// ---------------------------------------------------------------------------
// env_lock_acquire
// ---------------------------------------------------------------------------

export const ACQUIRE_TOOL_NAME = 'env_lock_acquire';
export const ACQUIRE_TOOL_DESCRIPTION =
  'Acquire the local dev env lease. Returns acquired:true on success or acquired:false (with queue position) ' +
  "if held by another agent. priority:'operator' preempts the current holder, displacing them to the front " +
  'of the queue with preempted:true. Auto-defaults branch via git and worktree to the MCP server cwd.';

export interface AcquireParams {
  branch?: string;
  worktree?: string;
  purpose: string;
  pid?: number;
  ttl_minutes?: number;
  priority?: 'normal' | 'operator';
}

export async function executeAcquire(params: AcquireParams): Promise<unknown> {
  const worktree = params.worktree ?? process.cwd();
  const branch = params.branch ?? (await detectBranch(worktree));
  const ttl = params.ttl_minutes ?? 60;
  const priority = params.priority ?? 'normal';
  const pidPart = params.pid !== undefined ? ` --pid ${params.pid}` : '';
  const agentId = getAgentId(branch, worktree);
  const cmd =
    `bash ${q(SCRIPT_PATH)} acquire ${q(branch)} ${q(worktree)} ${q(params.purpose)}` +
    `${pidPart} --ttl-minutes ${ttl} --priority ${priority} --agent-id ${q(agentId)}`;
  const result = await shell(cmd);
  return parseJson(result.stdout, 'acquire');
}

// ---------------------------------------------------------------------------
// env_lock_release
// ---------------------------------------------------------------------------

export const RELEASE_TOOL_NAME = 'env_lock_release';
export const RELEASE_TOOL_DESCRIPTION =
  'Release the local dev env lease (or remove yourself from the queue). Auto-defaults branch ' +
  'via git and worktree to the MCP server cwd. Always call this when you are done with env-needing work. ' +
  "Matches by agent_id (primary, stable across deploy_dev.sh's PID re-anchor under a different cwd) and " +
  'falls back to (branch, worktree) match for compatibility with the bare CLI.';

export interface ReleaseParams {
  branch?: string;
  worktree?: string;
}

export async function executeRelease(params: ReleaseParams): Promise<unknown> {
  const worktree = params.worktree ?? process.cwd();
  const branch = params.branch ?? (await detectBranch(worktree));
  // Prefer the holder's stamped agent_id over a fresh derivation: a
  // branch rename (or any other branch drift) between acquire and release
  // would otherwise yield a different sha1(branch, worktree) and miss
  // the holder via is_holder_by_agent AND is_holder_self (holder.branch
  // would still be the OLD branch). Worktree path is the immutable
  // anchor — if the holder's worktree matches ours, treat the holder as
  // us and reuse its stamped agent_id. Edge case: two distinct MCP
  // servers sharing the same worktree would cross-release; that
  // pathological case is no worse than today's (branch, worktree)
  // fallback already in place.
  let agentId = getAgentId(branch, worktree);
  try {
    const status = await executeStatus();
    if (
      status &&
      typeof status === 'object' &&
      !('error' in status) &&
      status.holder &&
      status.holder.worktree === worktree &&
      typeof status.holder.agent_id === 'string' &&
      status.holder.agent_id.length > 0
    ) {
      agentId = status.holder.agent_id;
    }
  } catch {
    // Status query failed for any reason — fall through with the
    // computed agent_id. Release will still attempt is_holder_self
    // fallback in the bash script.
  }
  const cmd = `bash ${q(SCRIPT_PATH)} release ${q(branch)} ${q(worktree)} --agent-id ${q(agentId)}`;
  const result = await shell(cmd);
  return parseJson(result.stdout, 'release');
}

// ---------------------------------------------------------------------------
// env_lock_force_release
// ---------------------------------------------------------------------------

export const FORCE_RELEASE_TOOL_NAME = 'env_lock_force_release';
export const FORCE_RELEASE_TOOL_DESCRIPTION =
  'Operator-only override: clear the current env lease unconditionally. Use ONLY when a lease is ' +
  "genuinely stuck and auto-expiry isn't clearing it. Ask the operator before calling.";

export async function executeForceRelease(): Promise<unknown> {
  const result = await shell(`bash ${q(SCRIPT_PATH)} force-release`);
  return parseJson(result.stdout, 'force-release');
}

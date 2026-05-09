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
  const cmd =
    `bash ${q(SCRIPT_PATH)} acquire ${q(branch)} ${q(worktree)} ${q(params.purpose)}` +
    `${pidPart} --ttl-minutes ${ttl} --priority ${priority}`;
  const result = await shell(cmd);
  return parseJson(result.stdout, 'acquire');
}

// ---------------------------------------------------------------------------
// env_lock_release
// ---------------------------------------------------------------------------

export const RELEASE_TOOL_NAME = 'env_lock_release';
export const RELEASE_TOOL_DESCRIPTION =
  'Release the local dev env lease (or remove yourself from the queue). Auto-defaults branch ' +
  'via git and worktree to the MCP server cwd. Always call this when you are done with env-needing work.';

export interface ReleaseParams {
  branch?: string;
  worktree?: string;
}

export async function executeRelease(params: ReleaseParams): Promise<unknown> {
  const worktree = params.worktree ?? process.cwd();
  const branch = params.branch ?? (await detectBranch(worktree));
  const cmd = `bash ${q(SCRIPT_PATH)} release ${q(branch)} ${q(worktree)}`;
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

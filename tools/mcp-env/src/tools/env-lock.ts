import { createHash } from 'node:crypto';
import { promises as fs, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

// =============================================================================
// ENV-4 persist-to-file (Codex pre-push review, 2026-05-23):
// the derivation above only matches when release computes the SAME inputs as
// acquire — i.e. caller's branch+worktree match what acquire saw. The real
// failure mode the ROK-1318 spec called out is the MCP wrapper being invoked
// from a DIFFERENT cwd than the worktree the lease holds (e.g. MCP server
// cwd is the main repo; lease is for a sibling worktree). In that case the
// fresh derivation produces a different agent_id and the bash branch+worktree
// fallback also misses.
//
// Fix: stamp the agent_id ONCE on acquire and persist to a stable path
// (~/.raid-ledger/mcp-agent-id). On release, read the persisted value first;
// fall back to current-holder agent_id via status if the file is missing;
// finally fall back to fresh derivation. Clear the file on successful release
// or force-release so the next acquire starts clean.
// =============================================================================

let agentIdFilePathOverride: string | null = null;

/** Test-only injection point for the persisted agent_id file path. */
export function _setAgentIdFilePathForTesting(path: string | null): void {
  agentIdFilePathOverride = path;
}

function getAgentIdFilePath(): string {
  return agentIdFilePathOverride ?? join(homedir(), '.raid-ledger', 'mcp-agent-id');
}

async function persistAgentId(agentId: string): Promise<void> {
  try {
    const filePath = getAgentIdFilePath();
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, agentId, { mode: 0o600 });
  } catch {
    // Best-effort: release will fall back to status-lookup then fresh derivation.
  }
}

async function loadPersistedAgentId(): Promise<string | null> {
  try {
    const filePath = getAgentIdFilePath();
    if (!existsSync(filePath)) return null;
    const contents = await fs.readFile(filePath, 'utf8');
    const trimmed = contents.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function clearPersistedAgentId(): Promise<void> {
  try {
    await fs.unlink(getAgentIdFilePath());
  } catch {
    // OK if it didn't exist or perm-denied; nothing to do.
  }
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
  // ENV-4: persist the stamped agent_id BEFORE the shell call so that even
  // if the script crashes mid-acquire, a subsequent release call can find
  // the id we intended to use. Best-effort — release has fallback paths.
  await persistAgentId(agentId);
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
  // ENV-4: identity resolution, three-tier fallback:
  //   1. Persisted on-disk stamp (~/.raid-ledger/mcp-agent-id) — set by
  //      acquire, survives MCP server restarts AND any cwd/branch drift
  //      between acquire and release. This is the only path that fixes
  //      the original ROK-1318 spec scenario (MCP server cwd != holder.worktree).
  //   2. Current holder's agent_id read from env_lock_status — covers
  //      cases where the persist file was wiped (e.g. fresh MCP install
  //      reading a lease from a prior session that an operator's CLI took).
  //   3. Fresh derivation from current (branch, worktree) — same as
  //      pre-ENV-4 behavior; works when caller's branch+worktree happen
  //      to match the holder.
  let agentId: string;
  const persisted = await loadPersistedAgentId();
  if (persisted) {
    // Tier 1: persisted stamp. Correct-by-construction — this MCP server
    // wrote the file on its own acquire call. No additional guard needed.
    agentId = persisted;
  } else {
    let resolved: string | null = null;
    try {
      const status = await executeStatus();
      if (
        status &&
        typeof status === 'object' &&
        !('error' in status) &&
        status.holder &&
        typeof status.holder.agent_id === 'string' &&
        status.holder.agent_id.length > 0 &&
        // Tier 2 guard: only reuse the holder's stamped agent_id if its
        // worktree matches ours. Without the guard, a fresh MCP server
        // (no persisted file) could steal another MCP server's lease just
        // by being in the right window. Worktree-only match preserves the
        // branch-rename-mid-lease win without enabling cross-worktree theft.
        // Same shared-worktree risk as today's bash is_holder_self path.
        status.holder.worktree === worktree
      ) {
        resolved = status.holder.agent_id;
      }
    } catch {
      // Status query failed; fall through to fresh derivation.
    }
    // Tier 3: fresh derivation. Pre-ENV-4 behavior. Works when caller's
    // branch+worktree happen to match the holder (i.e. nothing drifted).
    agentId = resolved ?? getAgentId(branch, worktree);
  }
  const cmd = `bash ${q(SCRIPT_PATH)} release ${q(branch)} ${q(worktree)} --agent-id ${q(agentId)}`;
  const result = await shell(cmd);
  const parsed = parseJson(result.stdout, 'release');
  // Clear the persisted stamp on a successful release so the next acquire
  // starts with a fresh, accurate identity. On no-op release (was_holder
  // false) the stamp stays — there may be a queued-entry path we want to
  // continue tracking, and the next acquire will overwrite the stamp anyway.
  if (
    parsed &&
    typeof parsed === 'object' &&
    'was_holder' in parsed &&
    (parsed as { was_holder?: unknown }).was_holder === true
  ) {
    await clearPersistedAgentId();
  }
  return parsed;
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
  // ENV-4: force-release clears the holder unconditionally; drop our local
  // stamp too so a subsequent acquire starts clean.
  await clearPersistedAgentId();
  return parseJson(result.stdout, 'force-release');
}

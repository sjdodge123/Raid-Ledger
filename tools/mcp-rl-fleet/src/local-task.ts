// ROK-1362 — laptop-side task registry.
//
// rl_env_deploy + rl_env_clone_prod run on the OPERATOR LAPTOP (step 4
// sync-settings reads the operator's local DB), so they cannot be VM tasks.
// This module mirrors the VM task JSON shape under ~/.raid-ledger/tasks/ so a
// single status/wait/cancel surface renders both. `local-<12 hex>` ids are the
// namespace router: task.ts routes them here, everything else to SSH.
//
// Leaf-ish: imports task-schemas (pure zod) + node builtins only. Never imports
// task.ts, so task.ts -> local-task.ts -> task-schemas.ts stays acyclic.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  fstatSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  TaskStepSchema,
  McpRuntimeStatusSchema,
  STILL_RUNNING_LOG_TAIL_DEFAULT,
  buildStillRunning,
  isTerminalStatus,
  type ExecuteStatusReturn,
  type StillRunningResult,
} from './tools/task-schemas.js';

export const LOCAL_TASK_ID_RE = /^local-[a-z0-9]{8,32}$/;
export const isLocalTaskId = (id: string): boolean => LOCAL_TASK_ID_RE.test(id);

export const LocalTaskJsonSchema = z.object({
  task_id: z.string().regex(LOCAL_TASK_ID_RE),
  tool: z.enum(['rl_env_deploy', 'rl_env_clone_prod']),
  slot: z.number().int().nullable(),
  args_summary: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  mcp_runtime_status: McpRuntimeStatusSchema,
  script_exit_code: z.number().int().nullable(),
  steps: z.array(TaskStepSchema),
  current_step: z.string().nullable(),
  log_path: z.string(),
  pid: z.number().int(),
  failed_step: z.string().nullable(),
  error: z.string().optional(),
  message: z.string().optional(),
});
export type LocalTaskJson = z.infer<typeof LocalTaskJsonSchema>;

export function tasksDir(): string {
  return join(homedir(), '.raid-ledger', 'tasks');
}
export function localJsonPath(id: string): string {
  return join(tasksDir(), `${id}.json`);
}
export function localLogPath(id: string): string {
  return join(tasksDir(), `${id}.log`);
}
export function newLocalTaskId(): string {
  return `local-${randomBytes(6).toString('hex')}`;
}

/** mkdir -p ~/.raid-ledger/tasks (mode 0700). Idempotent. */
export function ensureTasksDir(): void {
  mkdirSync(tasksDir(), { recursive: true, mode: 0o700 });
}

/** Atomic write (temp + rename) so a concurrent reader never sees a torn file. */
export function writeLocalTask(task: LocalTaskJson): void {
  ensureTasksDir();
  const final = localJsonPath(task.task_id);
  const tmp = `${final}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(task, null, 2), { mode: 0o600 });
  renameSync(tmp, final);
}

/** signal-0 liveness probe. Our own child (same uid) → ESRCH = dead. */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Read+validate the raw JSON. null when missing/unparseable. */
export function readRawLocalTask(id: string): LocalTaskJson | null {
  let text: string;
  try {
    text = readFileSync(localJsonPath(id), 'utf8');
  } catch {
    return null;
  }
  const parsed = LocalTaskJsonSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

/** Last `bytes` of the task .log (best-effort; '' when unreadable). */
export function localLogTail(id: string, bytes: number): string {
  const cap = Math.max(0, bytes);
  if (cap === 0) return '';
  let fd: number | undefined;
  try {
    fd = openSync(localLogPath(id), 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(cap, size);
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function processDied(id: string, raw: LocalTaskJson): ExecuteStatusReturn {
  return {
    ...toStatusReturn(id, raw, STILL_RUNNING_LOG_TAIL_DEFAULT),
    ok: false,
    mcp_runtime_status: 'failed',
    finished_at: raw.finished_at,
    error: 'process_died',
    message:
      'Laptop task process is no longer alive but JSON was never finalized — ' +
      'the laptop likely slept/rebooted or the process was killed mid-chain. ' +
      'Re-run rl_env_deploy.',
  };
}

function toStatusReturn(
  id: string,
  raw: LocalTaskJson,
  logTailBytes: number,
): ExecuteStatusReturn {
  const end = raw.finished_at ? Date.parse(raw.finished_at) : Date.now();
  const elapsed = Math.max(0, Math.round((end - Date.parse(raw.started_at)) / 1000));
  return {
    ok: true,
    task_id: id,
    tool: raw.tool,
    slot: raw.slot,
    args_summary: raw.args_summary,
    started_at: raw.started_at,
    finished_at: raw.finished_at,
    elapsed_seconds: elapsed,
    mcp_runtime_status: raw.mcp_runtime_status,
    script_exit_code: raw.script_exit_code,
    steps: raw.steps,
    current_step: raw.current_step,
    log_tail: localLogTail(id, logTailBytes),
    log_path: raw.log_path,
    failed_step: raw.failed_step,
    error: raw.error,
    message: raw.message,
  } as ExecuteStatusReturn;
}

/** rl_task_status for a `local-` id (no SSH). PID-liveness synth on stale running. */
export function readLocalTask(id: string, logTailBytes?: number): ExecuteStatusReturn {
  const raw = readRawLocalTask(id);
  if (!raw) {
    return { ok: false, error: 'task_not_found', task_id: id, steps: [] };
  }
  if (raw.mcp_runtime_status === 'running' && !isPidAlive(raw.pid)) {
    return processDied(id, raw);
  }
  return toStatusReturn(id, raw, logTailBytes ?? 51200);
}

/** Resolve true on a JSON change, false on timeout. Re-armed each call so an
 *  atomic rename (new inode) is observed by the NEXT iteration. Caps each slice
 *  at 2s so a missed fs event still yields a fresh state read. */
function watchOnce(file: string, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let w: ReturnType<typeof watch> | undefined;
    const finish = (v: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        w?.close();
      } catch {
        /* ignore */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), Math.max(50, Math.min(ms, 2000)));
    try {
      w = watch(file, () => finish(true));
    } catch {
      finish(false);
    }
  });
}

/** rl_task_wait for a `local-` id. Same 120s cap + still_running envelope. */
export async function waitLocalTask(
  id: string,
  timeoutS?: number,
  logTailBytes?: number,
): Promise<ExecuteStatusReturn | StillRunningResult> {
  const capped = Math.max(5, Math.min(120, timeoutS ?? 120));
  const deadline = Date.now() + capped * 1000;
  let cur = readLocalTask(id, logTailBytes);
  if (!cur.ok || isTerminalStatus(cur.mcp_runtime_status)) return cur;
  while (Date.now() < deadline) {
    await watchOnce(localJsonPath(id), deadline - Date.now());
    cur = readLocalTask(id, logTailBytes);
    if (!cur.ok || isTerminalStatus(cur.mcp_runtime_status)) return cur;
  }
  return buildStillRunning(readLocalTask(id, STILL_RUNNING_LOG_TAIL_DEFAULT), capped);
}

export interface CancelLocalResult {
  ok: boolean;
  task_id: string;
  cancelled?: boolean;
  mcp_runtime_status?: string;
  error?: string;
  message?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** rl_task_cancel for a `local-` id: SIGTERM, brief grace, SIGKILL, write
 *  terminal `cancelled`. Idempotent on an already-terminal task. */
export async function cancelLocalTask(
  id: string,
  reason: string,
): Promise<CancelLocalResult> {
  const raw = readRawLocalTask(id);
  if (!raw) return { ok: false, task_id: id, error: 'task_not_found' };
  if (isTerminalStatus(raw.mcp_runtime_status)) {
    return { ok: true, task_id: id, cancelled: true, mcp_runtime_status: raw.mcp_runtime_status };
  }
  try {
    process.kill(raw.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 10 && isPidAlive(raw.pid); i++) await sleep(200);
  if (isPidAlive(raw.pid)) {
    try {
      process.kill(raw.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  writeLocalTask({
    ...raw,
    mcp_runtime_status: 'cancelled',
    finished_at: new Date().toISOString(),
    message: `cancelled: ${reason}`,
  });
  return { ok: true, task_id: id, cancelled: true, mcp_runtime_status: 'cancelled' };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
/** src/tools/runner-entry.ts — the detached chain runner entry. */
export function runnerEntryPath(): string {
  return join(__dirname, 'tools', 'runner-entry.ts');
}
/** The mcp-rl-fleet package dir (has node_modules + tsconfig) — child cwd. */
function packageDir(): string {
  return resolve(__dirname, '..');
}

export interface SpawnLocalRunnerResult {
  task_id: string;
  pid: number;
  started_at: string;
}

/**
 * Spawn the detached, unref'd chain runner (`npx tsx runner-entry.ts <id> <tool>
 * <paramsJson>`) — matches the proven `.mcp.json` invocation so tsx resolves.
 * Writes the initial `running` task JSON (with the child pid) BEFORE returning so
 * an immediate rl_task_status read never races to task_not_found. The child
 * outlives this MCP request (reaped by init, not the server).
 */
export function spawnLocalRunner(
  taskId: string,
  tool: 'rl_env_deploy' | 'rl_env_clone_prod',
  params: unknown,
  argsSummary: string,
): SpawnLocalRunnerResult {
  ensureTasksDir();
  const logFd = openSync(localLogPath(taskId), 'a');
  const child = spawn(
    'npx',
    ['tsx', runnerEntryPath(), taskId, tool, JSON.stringify(params)],
    { detached: true, stdio: ['ignore', logFd, logFd], cwd: packageDir(), env: process.env },
  );
  child.unref();
  closeSync(logFd);
  const startedAt = new Date().toISOString();
  writeLocalTask({
    task_id: taskId,
    tool,
    slot: null,
    args_summary: argsSummary,
    started_at: startedAt,
    finished_at: null,
    mcp_runtime_status: 'running',
    script_exit_code: null,
    steps: [],
    current_step: 'starting',
    log_path: localLogPath(taskId),
    pid: child.pid ?? -1,
    failed_step: null,
  });
  return { task_id: taskId, pid: child.pid ?? -1, started_at: startedAt };
}

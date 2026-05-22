// ROK-1338 PR-2 — rl_task_logs: tail the supervisor stdout+stderr log file
// for a running or completed task.
//
// Companion to rl_task_inspect (full task JSON) and rl_task_status (summarized
// status with capped log_tail). Use this when you want a fresh, configurably-
// deep slice of the actual log file at `/srv/rl-infra/state/tasks/<id>.log`.
//
// No `worktree_path` param — this is a read-only inspection tool, consistent
// with PR-1's rl_task_inspect + rl_infra_logs. Future maintainers: do NOT add
// it for parity (PR-1 codex [nit] feedback, already in TECH-DEBT-BACKLOG.md).

import { z } from 'zod';
import { execFileP, shellQuote, synthesizeEmptyStderrDiagnostic } from '../exec.js';
import { TASK_ID_RE } from './task.js';

export const TOOL_NAME = 'rl_task_logs';
export const TOOL_DESCRIPTION =
  'Tail the supervisor stdout+stderr log for a task: returns the last N lines of /srv/rl-infra/state/tasks/<id>.log. Companion to rl_task_inspect (forensic JSON state) and rl_task_status (summarized status with capped log_tail). Use when you want a fresh, configurably-deep slice of the real log file. lines defaults to 100, max 5000. follow:true is deferred in v1 — poll rl_task_status instead.';

const LINES_MAX = 5000;
const LINES_DEFAULT = 100;

export const TaskLogsParamsSchema = z.object({
  task_id: z.string().regex(TASK_ID_RE),
  lines: z.number().int().positive().max(LINES_MAX).optional(),
  follow: z.boolean().optional(),
});

export type TaskLogsParams = z.infer<typeof TaskLogsParamsSchema>;

export interface TaskLogsResult {
  ok: boolean;
  task_id?: string;
  /** Deterministic VM-side path: /srv/rl-infra/state/tasks/<task_id>.log */
  log_path?: string;
  /** Tail output split on \n with empty entries dropped. */
  lines?: string[];
  /** True on ERR_CHILD_PROCESS_STDIO_MAXBUFFER (64KB cap hit). */
  truncated?: boolean;
  /** Reserved for follow:true v2; always omitted in v1. */
  followed?: boolean;
  error?: string;
  message?: string;
  hint?: string;
}

const sshUser = (): string => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = (): string => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

/** Build the canonical ssh argv-array. Never `bash -c`. */
function sshArgs(remote: string): [string, string[]] {
  return [
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser()}@${sshHost()}`, remote],
  ];
}

/** Returns the VM-side log path for a task_id. Single source of truth. */
function logPathFor(taskId: string): string {
  return `/srv/rl-infra/state/tasks/${taskId}.log`;
}

/**
 * Execute `rl_task_logs`. Defense-in-depth Zod re-validation BEFORE shell.
 *
 * v1 scope (operator-OK per spec ROK-1338-pr2.md):
 *   - lines: optional positive int, default 100, max 5000.
 *   - follow:true → returns {ok:false, error:"follow_not_implemented_in_v1",
 *     hint:"…"}; deferred until inotifywait probe + watcher loop pattern from
 *     task.ts::executeWait is ported. Direct tail is sufficient for v1.
 */
export async function execute(params: TaskLogsParams): Promise<TaskLogsResult> {
  const validated = TaskLogsParamsSchema.safeParse(params);
  if (!validated.success) {
    return {
      ok: false,
      error: 'invalid_params',
      message: validated.error.message,
    };
  }
  const { task_id } = validated.data;
  const lines = validated.data.lines ?? LINES_DEFAULT;
  const follow = validated.data.follow ?? false;

  if (follow) {
    return {
      ok: false,
      error: 'follow_not_implemented_in_v1',
      task_id,
      hint:
        'follow:true is deferred in v1. Poll rl_task_status (cheap; ' +
        'returns log_tail) or use rl_task_wait (blocks until terminal state).',
    };
  }

  const logPath = logPathFor(task_id);
  // task_id is regex-validated [a-z0-9]{8,32} so shellQuote is belt-and-
  // suspenders. lines is a Zod-checked positive int <= 5000 — direct
  // interpolation is safe.
  //
  // 2>&1 merges tail's own stderr ("No such file") into stdout so a single
  // capture sees the whole picture. Mirrors infra-logs.ts pattern.
  const remote = `tail -n ${lines} ${shellQuote(logPath)} 2>&1`;
  const [cmd, args] = sshArgs(remote);

  // 64KB cap — matches rl_infra_logs precedent. Each tail line is normally
  // small; ERR_CHILD_PROCESS_STDIO_MAXBUFFER is the runaway-line escape valve.
  const MAX_BUFFER = 64 * 1024;
  try {
    const { stdout } = await execFileP(cmd, args, {
      maxBuffer: MAX_BUFFER,
      timeout: 30_000,
    });
    return {
      ok: true,
      task_id,
      log_path: logPath,
      lines: splitNonEmpty(stdout),
      truncated: false,
    };
  } catch (err) {
    return classifyError(err, task_id, logPath);
  }
}

/** Split a tail blob on \n and drop empty entries. */
function splitNonEmpty(blob: string): string[] {
  return blob.split('\n').filter((l) => l.length > 0);
}

/**
 * Map an execFile rejection to a TaskLogsResult. Handles three buckets:
 *   1. maxBuffer overflow → ok:true + truncated:true with captured bytes.
 *   2. ENOENT-style "No such file or directory" from tail → task_log_not_found.
 *   3. Anything else → task_logs_failed with synthesized-or-verbatim message.
 *
 * tail uses `2>&1` so its own error text arrives via stdout, not stderr. We
 * read from BOTH streams when classifying so structured errors keep their
 * specificity (mirrors infra-logs.ts codex P2 fix).
 */
function classifyError(
  err: unknown,
  taskId: string,
  logPath: string,
): TaskLogsResult {
  const e = err as Error & {
    stdout?: string;
    stderr?: string;
    code?: number | string;
  };
  // maxBuffer overflow: return partial bytes with truncated:true.
  if (
    e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
    /maxBuffer/i.test(e.message)
  ) {
    const captured = (e.stdout ?? '') + (e.stderr ?? '');
    return {
      ok: true,
      task_id: taskId,
      log_path: logPath,
      lines: splitNonEmpty(captured),
      truncated: true,
    };
  }
  // Read from BOTH streams: with 2>&1, tail's error arrives via stdout.
  const captured = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
  const message =
    captured === ''
      ? synthesizeEmptyStderrDiagnostic(typeof e.code === 'number' ? e.code : undefined)
      : captured;
  if (/No such file or directory/i.test(message)) {
    return {
      ok: false,
      task_id: taskId,
      log_path: logPath,
      error: 'task_log_not_found',
      message,
    };
  }
  return {
    ok: false,
    task_id: taskId,
    log_path: logPath,
    error: 'task_logs_failed',
    message,
  };
}

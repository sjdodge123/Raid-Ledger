// ROK-1331 M2 — MCP task tools: status / wait / cancel / list.
//
// These tools wrap the orchestrator's task-* binaries that M1 ships. The
// orchestrator owns task lifecycle on the VM (pid-file, log tee, JSON
// state); the MCP layer only reads + signals via SSH. All four executors
// parse stdout JSON and surface the orchestrator's response verbatim.
//
// Bug B (ROK-1331, 2026-05-20): the task-status JSON shape separates
//   - script_exit_code  (the wrapped command's exit code; null while running)
//   - mcp_runtime_status (the runtime classification: running/succeeded/...)
// `log_tail` is capped to a caller-supplied byte count (default 51200,
// max 1048576). Bytes — not lines — because validate-ci logs can contain
// long progress lines and we want a deterministic cap on payload size.
// `steps[]` comes from M1's PASS/FAIL parser running over the log.

import { z } from 'zod';
import {
  buildSshArgs,
  classifySshFailure,
  execFileP,
  shellQuote,
  synthesizeEmptyStderrDiagnostic,
} from '../exec.js';

export const TASK_ID_RE = /^[a-z0-9]{8,32}$/;
export const taskIdSchema = z.string().regex(TASK_ID_RE);

export const McpRuntimeStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'killed_buffer_overflow',
  'killed_timeout',
  'cancelled',
]);

export const TaskStepSchema = z.object({
  name: z.string(),
  status: z.enum(['PASS', 'FAIL', 'SKIPPED']),
  duration_s: z.number().nullable(),
});

// ISO-8601 sanity check — Zod 3 has no native datetime in our pinned slice
// of the API, so we use a lightweight regex. Anything resembling a date
// passes; pathological "not-a-date" strings get rejected.
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'must be ISO-8601 datetime');

export const TaskStatusResultSchema = z.object({
  ok: z.boolean(),
  task_id: taskIdSchema,
  tool: z.string(),
  slot: z.number().int().nullable(),
  args_summary: z.string(),
  started_at: isoDateSchema,
  finished_at: isoDateSchema.nullable(),
  elapsed_seconds: z.number().int(),
  mcp_runtime_status: McpRuntimeStatusSchema,
  script_exit_code: z.number().int().nullable(),
  steps: z.array(TaskStepSchema),
  log_tail: z.string(),
  log_url: z.string(),
  log_path: z.string(),
  // M5b extensions — appended by the orchestrator when the .log is readable.
  // Optional + nullable so old/in-flight responses still parse.
  last_output_at: isoDateSchema.nullable().optional(),
  last_line: z.string().nullable().optional(),
  current_step: z.string().nullable().optional(),
  progress_hint: z.string().nullable().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export type TaskStatusResult = z.infer<typeof TaskStatusResultSchema>;

// Wide return type for executeStatus: the orchestrator may either return a
// full TaskStatusResult OR a `{ok:false, error, task_id}` envelope when the
// task is missing / SSH failed. We surface either shape verbatim. Property
// access at the call site checks `ok` first; this loose typing keeps test
// assertions ergonomic without forcing a `'tool' in result` discriminator
// everywhere.
export interface ExecuteStatusReturn extends Partial<TaskStatusResult> {
  ok: boolean;
  task_id?: string;
  error?: string;
  message?: string;
  /** ROK-1338 PR-3: populated when classifySshFailure returns ssh_denied/ssh_unreachable. */
  hint?: string;
  // executeStatus normalizes `steps` to [] on success-shape responses (and
  // omits it on raw error envelopes). Declared as a non-optional array so
  // callers can write `result.steps.length` without a chain of null checks.
  // The runtime contract is enforced at the executeStatus exit boundary.
  steps: TaskStatusResult['steps'];
}

async function sshArgs(remote: string): Promise<[string, string[]]> {
  return ['ssh', await buildSshArgs(remote)];
}

/**
 * Parse the orchestrator's stdout JSON. Returns null on parse failure so
 * callers can surface a useful error rather than blowing up.
 */
function parseJson<T>(stdout: string): T | null {
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    // Try last-line strategy for binaries that prepend human text.
    const last = stdout.trim().split('\n').pop();
    if (!last) return null;
    try {
      return JSON.parse(last) as T;
    } catch {
      return null;
    }
  }
}

// --------------------------------------------------------------------------
// rl_task_status — read current state of a task.
// --------------------------------------------------------------------------

export interface ExecuteStatusParams {
  task_id: string;
  /** Bug B: default 51200 bytes (50KB), max 1048576 (1MB). */
  log_tail_bytes?: number;
}

export async function executeStatus(params: ExecuteStatusParams): Promise<ExecuteStatusReturn> {
  const tail = params.log_tail_bytes ?? 51200;
  const remote =
    `/srv/rl-infra/orchestrator/bin/task-status ` +
    `${shellQuote(params.task_id)} --log-tail-bytes ${tail}`;
  const [cmd, args] = await sshArgs(remote);
  try {
    const { stdout } = await execFileP(cmd, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
    const parsed = parseJson<ExecuteStatusReturn>(stdout);
    if (!parsed) {
      return {
        ok: false,
        error: 'failed_to_parse_response',
        task_id: params.task_id,
        steps: [],
      };
    }
    // Normalize: steps[] is always an array, defaulting to [] on error
    // envelopes that omit it.
    return { ...parsed, steps: parsed.steps ?? [] };
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    // ROK-1338 PR-3 (B4): shared SSH classifier — surfaces sshd-denied
    // (post-lockdown) vs network-unreachable as structured errors so the
    // agent sees what kind of transport failure happened rather than a
    // generic task_status_failed envelope.
    const sshClass = classifySshFailure(e.code, stderr);
    if (sshClass) {
      return {
        ok: false,
        task_id: params.task_id,
        ...sshClass,
        message: stderr,
        steps: [],
      };
    }
    return {
      ok: false,
      error: 'task_status_failed',
      task_id: params.task_id,
      message: stderr,
      steps: [],
    };
  }
}

// --------------------------------------------------------------------------
// rl_task_wait — block until task transitions to terminal OR timeout.
// --------------------------------------------------------------------------

export interface ExecuteWaitParams {
  task_id: string;
  timeout_seconds?: number;
  log_tail_bytes?: number;
}

// Wide wait return: timed_out, inotifywait_not_installed, or a full status
// shape. Keep it loosely typed (Partial<TaskStatusResult> + extra optional
// fields) so callers can read `task_id` / `waited_seconds` / `hint` without
// a runtime discriminator.
export interface ExecuteWaitResult extends Partial<TaskStatusResult> {
  ok: boolean;
  task_id?: string;
  error?: string;
  hint?: string;
  /**
   * ROK-1338 PR-3 (A3): true when the hint describes a step only the operator
   * can take (e.g. `apt-get install inotify-tools` on the VM). rl-agent
   * cannot act on it; the flag is a machine-readable marker for the
   * dashboard / MCP layer / agents to route the failure correctly.
   */
  operator_only?: boolean;
  waited_seconds?: number;
  message?: string;
  /** Mirrors the executeStatus-side normalization to make property access ergonomic. */
  steps?: TaskStatusResult['steps'];
}

/** True when mcp_runtime_status is anything except 'running'. */
function isTerminalStatus(s: string | undefined | null): boolean {
  return !!s && s !== 'running';
}

export async function executeWait(params: ExecuteWaitParams): Promise<ExecuteWaitResult> {
  const timeoutS = Math.max(5, Math.min(3600, params.timeout_seconds ?? 600));
  const overallDeadlineMs = Date.now() + timeoutS * 1000;

  // Preflight: probe inotifywait availability. Mirrors test-plan's pattern.
  const probeRemote = 'command -v inotifywait';
  const [probeCmd, probeArgs] = await sshArgs(probeRemote);
  try {
    await execFileP(probeCmd, probeArgs, { timeout: 10_000 });
  } catch (probeErr) {
    const e = probeErr as Error & { stderr?: string; code?: number };
    const probeStderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    // ROK-1338 PR-3 (B4): if the probe failed at the SSH transport (denied
    // or unreachable), surface that — not the misleading "inotify is
    // missing" envelope. Post-lockdown, the probe SSH call is the FIRST
    // SSH call this tool makes; a ssh_denied here would otherwise pin the
    // entire wait loop on a retry that can never succeed.
    const sshClass = classifySshFailure(e.code, probeStderr);
    if (sshClass) {
      return {
        ok: false,
        task_id: params.task_id,
        ...sshClass,
        message: probeStderr,
      };
    }
    return {
      ok: false,
      error: 'inotifywait_not_installed',
      // ROK-1338 PR-3 (A3): the operator installs inotify-tools; rl-agent
      // cannot sudo. operator_only flags this as a machine-readable
      // "escalate" signal so dashboards / agents don't show a self-fix path.
      operator_only: true,
      hint:
        'inotify-tools is missing on the rl-infra VM. This is operator-only ' +
        'to install (apt-get install -y inotify-tools); agents cannot ' +
        'self-remediate.',
    };
  }

  // ROK-1331 Session 4 dogfood (Codex P1-3): pre-check status BEFORE attaching
  // inotify. If the task already reached a terminal state, return immediately
  // — otherwise short / immediately-failing tasks finish before the watcher
  // attaches and we sit until timeout. inotifywait only fires on FUTURE events.
  const initial = await executeStatus({
    task_id: params.task_id,
    log_tail_bytes: params.log_tail_bytes,
  });
  if (initial.ok && isTerminalStatus(initial.mcp_runtime_status)) {
    return initial;
  }

  // ROK-1336 #8 — watch the per-task JSON file directly, not the parent
  // directory with a grep-on-filenames pipe. The old dir-watch+grep had
  // both a regex-anchor concern AND made wait:true calls pay the full
  // timeout latency for tasks whose log lines don't match
  // PATTERN_STEP_RESULT (e.g. docker build via rl_env_build_image_from_runner).
  //
  // Event set matters: state::mutate uses mktemp+jq+mv which replaces the
  // file inode atomically — the watched inode then receives IN_MOVE_SELF
  // (or IN_DELETE_SELF on the now-unlinked old target) and the watch ends.
  // Including those in -e makes inotifywait exit immediately on a mutate,
  // not just on a heartbeat touch (which fires IN_CLOSE_WRITE on the
  // surviving inode). The outer loop re-attaches each iteration so a
  // mid-flight mutate is safe — the next iteration watches the new inode.
  //
  // File must exist when inotify attaches (it does — task-start creates
  // both files before returning, and executeWait pre-checks status above
  // so we wouldn't reach this loop if the file were missing).
  const taskJsonPath = `/srv/rl-infra/state/tasks/${shellQuote(params.task_id)}.json`;
  const watchRemote = `inotifywait -q -e close_write,move_self,delete_self ${taskJsonPath}`;
  const [watchCmd, watchArgs] = await sshArgs(watchRemote);

  let lastStatus: ExecuteWaitResult = initial;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const remainingMs = overallDeadlineMs - Date.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        error: 'timed_out',
        task_id: params.task_id,
        waited_seconds: timeoutS,
      };
    }

    const cycleStartedMs = Date.now();
    try {
      await Promise.race([
        execFileP(watchCmd, watchArgs, {
          timeout: remainingMs,
          maxBuffer: 1024 * 1024,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                Object.assign(new Error('wait_timeout_local'), { code: 'WAIT_TIMEOUT' }),
              ),
            remainingMs,
          ),
        ),
      ]);
    } catch (err) {
      const e = err as Error & {
        code?: string | number;
        signal?: string;
        stderr?: string;
      };
      const overallElapsed = Math.round((Date.now() - (overallDeadlineMs - timeoutS * 1000)) / 1000);
      const cycleElapsedMs = Date.now() - cycleStartedMs;
      // Local-timer / SIGTERM / exceeded remaining budget → overall timeout.
      if (
        e.code === 'WAIT_TIMEOUT' ||
        e.signal === 'SIGTERM' ||
        cycleElapsedMs >= remainingMs - 100
      ) {
        // Final status read so caller gets the last-known state even on timeout.
        const finalStatus = await executeStatus({
          task_id: params.task_id,
          log_tail_bytes: params.log_tail_bytes,
        });
        if (finalStatus.ok && isTerminalStatus(finalStatus.mcp_runtime_status)) {
          return finalStatus;
        }
        return {
          ok: false,
          error: 'timed_out',
          task_id: params.task_id,
          waited_seconds: overallElapsed,
        };
      }
      // ROK-1338 PR-3 (B4): if the inotifywait SSH call hit sshd-denied or
      // host-unreachable, RETURN IMMEDIATELY rather than re-looping. Without
      // this, a Permission denied (publickey) at the watch SSH would pin
      // the entire loop on a retry that can never succeed until the
      // overall timeout fires.
      const watchStderr =
        !e.stderr || e.stderr.trim() === ''
          ? synthesizeEmptyStderrDiagnostic(
              typeof e.code === 'number' ? e.code : undefined,
            )
          : e.stderr;
      const sshClass = classifySshFailure(
        typeof e.code === 'number' ? e.code : undefined,
        watchStderr,
      );
      if (sshClass) {
        return {
          ok: false,
          task_id: params.task_id,
          ...sshClass,
          message: watchStderr,
        };
      }
      // Some other failure (SSH drop, grep nomatch, etc.) — surface current state.
      lastStatus = await executeStatus({
        task_id: params.task_id,
        log_tail_bytes: params.log_tail_bytes,
      });
      if (lastStatus.ok && isTerminalStatus(lastStatus.mcp_runtime_status)) {
        return lastStatus;
      }
      // Non-terminal + non-timeout: re-loop and keep waiting.
      continue;
    }

    // inotifywait fired — read state. If terminal, return; else re-loop.
    lastStatus = await executeStatus({
      task_id: params.task_id,
      log_tail_bytes: params.log_tail_bytes,
    });
    if (lastStatus.ok && isTerminalStatus(lastStatus.mcp_runtime_status)) {
      return lastStatus;
    }
    // Still running — heartbeat or steps[] write. Re-enter the loop.
  }
}

// --------------------------------------------------------------------------
// rl_task_cancel — signal a running task to exit gracefully.
// --------------------------------------------------------------------------

export interface ExecuteCancelParams {
  task_id: string;
  reason: string;
}

export interface ExecuteCancelResult {
  ok: boolean;
  task_id?: string;
  cancelled?: boolean;
  mcp_runtime_status?: string;
  error?: string;
  message?: string;
  /** ROK-1338 PR-3: populated when classifySshFailure returns ssh_denied/ssh_unreachable. */
  hint?: string;
}

export async function executeCancel(params: ExecuteCancelParams): Promise<ExecuteCancelResult> {
  // task-cancel takes positional args: <task_id> <reason>. Earlier versions of
  // this shim passed `--reason <reason>` which the binary recorded as
  // cancel_reason: "--reason" (the flag literal, not the value). Caught by the
  // ROK-1338 PR-3 zero-SSH dogfood.
  const remote =
    `/srv/rl-infra/orchestrator/bin/task-cancel ` +
    `${shellQuote(params.task_id)} ${shellQuote(params.reason)}`;
  const [cmd, args] = await sshArgs(remote);
  try {
    const { stdout } = await execFileP(cmd, args, {
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    });
    const parsed = parseJson<ExecuteCancelResult>(stdout);
    if (!parsed) {
      return {
        ok: false,
        error: 'failed_to_parse_response',
        task_id: params.task_id,
      };
    }
    // Idempotent surface: any ok:true response means the task is in a
    // terminal state. Stamp `cancelled: true` so callers don't have to
    // inspect mcp_runtime_status to know the operation took.
    return {
      ...parsed,
      cancelled: parsed.ok === true,
    };
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    // ROK-1338 PR-3 (B4): shared SSH classifier — surface ssh_denied /
    // ssh_unreachable before falling back to task_cancel_failed.
    const sshClass = classifySshFailure(e.code, stderr);
    if (sshClass) {
      return {
        ok: false,
        task_id: params.task_id,
        ...sshClass,
        message: stderr,
      };
    }
    return {
      ok: false,
      error: 'task_cancel_failed',
      task_id: params.task_id,
      message: stderr,
    };
  }
}

// --------------------------------------------------------------------------
// rl_task_list — list recent tasks across slots.
// --------------------------------------------------------------------------

export interface ExecuteListParams {
  slot?: number;
  status?: z.infer<typeof McpRuntimeStatusSchema>;
  limit?: number;
}

export interface ExecuteListResult {
  ok: boolean;
  tasks?: Array<Omit<TaskStatusResult, 'log_tail'>>;
  error?: string;
  message?: string;
  /** ROK-1338 PR-3: populated when classifySshFailure returns ssh_denied/ssh_unreachable. */
  hint?: string;
}

export async function executeList(params: ExecuteListParams): Promise<ExecuteListResult> {
  const flags: string[] = [];
  if (typeof params.slot === 'number') flags.push(`--slot ${params.slot}`);
  if (params.status) flags.push(`--status ${shellQuote(params.status)}`);
  if (typeof params.limit === 'number') flags.push(`--limit ${params.limit}`);
  const remote =
    `/srv/rl-infra/orchestrator/bin/task-list${flags.length ? ' ' + flags.join(' ') : ''}`;
  const [cmd, args] = await sshArgs(remote);
  try {
    const { stdout } = await execFileP(cmd, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    });
    const parsed = parseJson<ExecuteListResult>(stdout);
    if (!parsed) {
      return {
        ok: false,
        error: 'failed_to_parse_response',
      };
    }
    return parsed;
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    // ROK-1338 PR-3 (B4): shared SSH classifier — surface ssh_denied /
    // ssh_unreachable before falling back to task_list_failed.
    const sshClass = classifySshFailure(e.code, stderr);
    if (sshClass) {
      return {
        ok: false,
        ...sshClass,
        message: stderr,
      };
    }
    return {
      ok: false,
      error: 'task_list_failed',
      message: stderr,
    };
  }
}

// --------------------------------------------------------------------------
// M5b — parseProgressHint (parser helper for tool-aware progress hints).
// Used by the orchestrator side to populate `progress_hint`. Exported from
// here so the schema-level extension tests can target a single source.
// --------------------------------------------------------------------------

export function parseProgressHint(tool: string, log: string): string | null {
  if (tool === 'rl_validate_ci') {
    // Jest verbose: `PASS  api/src/foo/foo.spec.ts (12 of 18)` — the
    // suite-of-suites marker. Take the LAST occurrence (latest progress).
    const jestProgress = [...log.matchAll(/\((\d+)\s+of\s+(\d+)\)/g)].pop();
    if (jestProgress) {
      return `jest: suite ${jestProgress[1]} of ${jestProgress[2]}`;
    }
    // Fallback: jest summary line — `Tests: ... 312 total`.
    const totalMatch = log.match(/Tests:[^\n]*?(\d+)\s+total/);
    if (totalMatch) {
      return `jest: ${totalMatch[1]} tests total`;
    }
    return null;
  }
  if (tool === 'rl_env_build_image_from_runner') {
    // BuildKit: `#15 [build 12/45] ...` OR classic: `Step 12/45 :`.
    const bkMatch = [...log.matchAll(/\[\w+\s+(\d+)\/(\d+)\]/g)].pop();
    if (bkMatch) {
      return `docker build: step ${bkMatch[1]} of ${bkMatch[2]}`;
    }
    const stepMatch = [...log.matchAll(/Step\s+(\d+)\/(\d+)\s*:/g)].pop();
    if (stepMatch) {
      return `docker build: step ${stepMatch[1]} of ${stepMatch[2]}`;
    }
    return null;
  }
  return null;
}

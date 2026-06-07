// ROK-1362 — shared task schemas extracted from task.ts.
//
// This is a LEAF module (imports only `zod`). It exists so that both task.ts
// (VM task status/wait/cancel) and local-task.ts (laptop task registry) can
// share TaskStepSchema / McpRuntimeStatusSchema / the still_running envelope
// WITHOUT a circular import: task.ts -> local-task.ts -> task-schemas.ts is
// acyclic because local-task.ts never imports task.ts. task.ts re-exports the
// symbols below so existing `from '../task.js'` importers keep working.

import { z } from 'zod';

// ROK-1362: widened to also accept the `local-` namespace prefix used by the
// laptop-side task registry (rl_env_deploy / rl_env_clone_prod). VM task ids
// stay `[a-z0-9]{8,32}`; laptop ids are `local-<12 hex>`.
export const TASK_ID_RE = /^(local-)?[a-z0-9]{8,32}$/;
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

// ISO-8601 sanity check — Zod 3 has no native datetime in our pinned slice of
// the API, so we use a lightweight regex. Anything resembling a date passes;
// pathological "not-a-date" strings get rejected.
export const isoDateSchema = z
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
  last_output_at: isoDateSchema.nullable().optional(),
  last_line: z.string().nullable().optional(),
  current_step: z.string().nullable().optional(),
  progress_hint: z.string().nullable().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

export type TaskStatusResult = z.infer<typeof TaskStatusResultSchema>;

// Wide return type for executeStatus: the orchestrator may either return a full
// TaskStatusResult OR a `{ok:false, error, task_id}` envelope when the task is
// missing / SSH failed. We surface either shape verbatim.
export interface ExecuteStatusReturn extends Partial<TaskStatusResult> {
  ok: boolean;
  task_id?: string;
  error?: string;
  message?: string;
  /** ROK-1338 PR-3: populated when classifySshFailure returns ssh_denied/ssh_unreachable. */
  hint?: string;
  steps: TaskStatusResult['steps'];
}

/** True when mcp_runtime_status is anything except 'running'. */
export function isTerminalStatus(s: string | undefined | null): boolean {
  return !!s && s !== 'running';
}

// --------------------------------------------------------------------------
// ROK-1362 — the `still_running` cap-expiry envelope.
//
// When a wait hits the 120s cap without the task reaching a terminal state, the
// response is a PROGRESS SNAPSHOT, not a bare timeout. It is narrated to a human
// terminal on a loop, so log_tail defaults SMALL (6KB) here vs rl_task_status's
// 51KB. `ok:false` is kept so existing `if (!result.ok)` guards still treat it
// as non-terminal; callers/scripts branch on `status === 'still_running'`.
// --------------------------------------------------------------------------

export const STILL_RUNNING_LOG_TAIL_DEFAULT = 6144; // 6 KiB
export const STILL_RUNNING_LOG_TAIL_MAX = 65536; // 64 KiB

// ROK-1362: the hard wait cap + its teaching message. The message is the
// deliverable for the rl_task_wait schema rejection — single-sourced here so
// the index.ts registration and the schema test can never drift apart.
export const WAIT_TIMEOUT_CAP_S = 120;
export const WAIT_CAP_TEACHING_MESSAGE =
  'rl_task_wait now caps each blocking call at 120s (ROK-1362). This is intentional: ' +
  'long blocking waits hide the agent from the operator. Pass <=120, and on a ' +
  "{status:'still_running'} response simply call rl_task_wait again with the SAME " +
  'task_id to keep waiting (each call returns a fresh progress snapshot). For a ' +
  'one-shot non-blocking read use rl_task_status.';

export const POLL_AGAIN_HINT =
  'Task still running after 120s. Re-call rl_task_wait with the same task_id to keep ' +
  'waiting (each call caps at 120s), or rl_task_status for a one-shot read.';

export const StillRunningResultSchema = z.object({
  ok: z.literal(false),
  status: z.literal('still_running'),
  task_id: z.string(),
  tool: z.string().nullable(),
  current_step: z.string().nullable(),
  steps: z.array(TaskStepSchema),
  log_tail: z.string(),
  elapsed_s: z.number().int(),
  waited_s: z.number().int(),
  poll_again_hint: z.string(),
});

export type StillRunningResult = z.infer<typeof StillRunningResultSchema>;

/** Type guard: a cap-expiry still_running snapshot (vs a terminal status). */
export function isStillRunning(x: unknown): x is StillRunningResult {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as { status?: unknown }).status === 'still_running'
  );
}

/**
 * Build the still_running snapshot from a fresh (non-terminal) status read.
 * `waitedS` is how long THIS wait call blocked (≈ the 120s cap); `elapsed_s` is
 * the task's wall-clock since started_at.
 */
export function buildStillRunning(
  status: ExecuteStatusReturn,
  waitedS: number,
): StillRunningResult {
  const elapsedS =
    typeof status.elapsed_seconds === 'number'
      ? status.elapsed_seconds
      : status.started_at
        ? Math.max(0, Math.round((Date.now() - Date.parse(status.started_at)) / 1000))
        : 0;
  const currentStep =
    status.current_step ?? status.progress_hint ?? status.last_line ?? null;
  return {
    ok: false,
    status: 'still_running',
    task_id: status.task_id ?? '',
    tool: status.tool ?? null,
    current_step: currentStep,
    steps: status.steps ?? [],
    log_tail: status.log_tail ?? '',
    elapsed_s: elapsedS,
    waited_s: waitedS,
    poll_again_hint: POLL_AGAIN_HINT,
  };
}

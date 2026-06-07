// rl_run_on_runner — execute a shell command inside the agent's claimed runner.
//
// SSHs directly into the VM to invoke the orchestrator's run-on-runner script.
// Forces agent identity.
//
// ROK-1362: bounded so no call holds the MCP channel > 120s.
//   timeout_seconds <= 120 (or omitted) → synchronous {stdout, stderr, exit_code}
//     as before. The sync default drops to 60 (short probes are this path's job).
//   timeout_seconds  > 120 → AUTO-ROUTED through the VM task-start wrapper (the
//     same primitive rl_validate_ci uses). Returns {ok:true, routed:'task',
//     task_id, log_url} in ~1s; poll rl_task_status / rl_task_wait. NOT rejected.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import {
  buildSshArgs,
  deriveAgentId,
  getSshTarget,
  shellQuote,
  synthesizeEmptyStderrDiagnostic,
} from '../exec.js';
import { execFileP, resolveSlot } from './runner-git.js';

const execFileAsync = promisify(execFile);

export const TOOL_NAME = 'rl_run_on_runner';
export const TOOL_DESCRIPTION =
  "Run a shell command inside the agent's claimed runner container (executes against the Mutagen-synced /workspace). Requires a slot claimed first (rl_claim — pair with rl_claim_wait if enqueued). Pass worktree_path if you claimed from a worktree. ROK-1362 bounded execution: with timeout_seconds<=120 (or omitted; default 60) it runs SYNCHRONOUSLY and returns {stdout, stderr, exit_code} — use this for short probes (`ls`, `cat`, a quick `git`/`grep`). With timeout_seconds>120 the command is AUTO-DISPATCHED as a VM task (NOT rejected) and returns {ok:true, routed:'task', task_id, log_url} in ~1s — poll rl_task_status / rl_task_wait (each wait caps at 120s) for stdout/log_tail. Use the >120 form for `npm test`, `npm run build`, `npx playwright test`, or anything long.";

const FLEET_DOMAIN = process.env.RL_FLEET_DOMAIN ?? 'fleet.gamernight.net';

export interface RunOnRunnerParams {
  /** Shell command to run inside the runner container (executed in /workspace). */
  command: string;
  /** Same worktree_path used at rl_claim / rl_claim_wait time. */
  worktree_path?: string;
  /** Soft timeout in seconds. Default 60. >120 auto-routes through task-start. */
  timeout_seconds?: number;
}

export interface RunOnRunnerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface RunOnRunnerRoutedResult {
  ok: boolean;
  /** Discriminant: the caller got a task_id, NOT stdout/exit_code. */
  routed: 'task';
  task_id?: string;
  log_url?: string;
  log_path?: string;
  started_at?: string;
  slot?: number;
  message: string;
  error?: string;
  stderr?: string;
}

/** ROK-1362: timeout_seconds > 120 → dispatch the command as a VM task. */
async function routeAsTask(
  params: RunOnRunnerParams,
  timeoutS: number,
): Promise<RunOnRunnerRoutedResult> {
  const { user: sshUser, host: sshHost } = await getSshTarget();
  const agentId = deriveAgentId(params.worktree_path);
  const slot = await resolveSlot(sshUser, sshHost, agentId);
  const taskId = randomBytes(6).toString('hex');
  const slotFlag = slot !== null ? `--slot ${slot} ` : '';
  const watchdogS = Math.min(7200, timeoutS);
  const targetCmd =
    `/srv/rl-infra/orchestrator/bin/run-on-runner-with-heartbeat ` +
    `-- bash -c ${shellQuote(params.command)}`;
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/task-start ${shellQuote(taskId)} ` +
    `--tool rl_run_on_runner ${slotFlag}--timeout-seconds ${watchdogS} ` +
    `-- ${targetCmd}`;

  let dispatch: { task_id?: string; log_path?: string; started_at?: string } = {};
  try {
    const { stdout } = await execFileP(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`, remote],
      { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    const last = stdout.trim().split('\n').pop() ?? '';
    try {
      dispatch = JSON.parse(stdout.trim()) as typeof dispatch;
    } catch {
      try {
        dispatch = JSON.parse(last) as typeof dispatch;
      } catch {
        /* falls through */
      }
    }
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    return { ok: false, routed: 'task', error: 'task_start_failed', stderr, message: 'failed to dispatch command as a VM task' };
  }

  const finalTaskId = dispatch.task_id ?? taskId;
  return {
    ok: true,
    routed: 'task',
    task_id: finalTaskId,
    log_url: `https://${FLEET_DOMAIN}/api/tasks/${finalTaskId}/log`,
    log_path: dispatch.log_path ?? `/srv/rl-infra/state/tasks/${finalTaskId}.log`,
    started_at: dispatch.started_at ?? new Date().toISOString(),
    slot: slot ?? undefined,
    message:
      `Command exceeds the 120s sync cap, so it was dispatched as a VM task (ROK-1362). ` +
      `Poll rl_task_status ${finalTaskId} for steps/log_tail, or rl_task_wait (each call caps at 120s).`,
  };
}

export async function execute(
  params: RunOnRunnerParams,
): Promise<RunOnRunnerResult | RunOnRunnerRoutedResult> {
  const timeoutS = params.timeout_seconds ?? 60;
  if (timeoutS > 120) {
    return routeAsTask(params, timeoutS);
  }

  const agentId = deriveAgentId(params.worktree_path);
  // CRITICAL (H-MCP-1): single-quote every user-controlled segment so the remote
  // login shell performs NO $(...)/backtick/${var} expansion.
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/run-on-runner ` +
    `-- bash -c ${shellQuote(params.command)}`;

  try {
    const sshArgs = await buildSshArgs(remote);
    const result = await execFileAsync('ssh', sshArgs, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutS * 1000,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr, exit_code: 0 };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exit_code: e.code ?? 1,
    };
  }
}

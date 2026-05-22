// ROK-1338 PR-1 — rl_task_inspect: forensic read of the full task JSON.
//
// Companion to rl_task_status: status returns the agent-friendly summary
// (log_tail capped, summarized fields). inspect returns the raw
// /srv/rl-infra/state/tasks/<id>.json contents verbatim so an operator
// or agent can pull fields that status doesn't surface (env block, exact
// command argv, internal state — whatever the orchestrator wrote).

import { execFileP, shellQuote, synthesizeEmptyStderrDiagnostic } from '../exec.js';
import { TASK_ID_RE } from './task.js';

export const TOOL_NAME = 'rl_task_inspect';
export const TOOL_DESCRIPTION =
  'Forensic read of a task: returns the FULL /srv/rl-infra/state/tasks/<id>.json contents as a raw object, with no log_tail capping or summary shaping. Use this when rl_task_status is missing a field you need (env block, raw argv, internal state). Validates task_id strictly. Read-only.';

export interface ExecuteInspectParams {
  task_id: string;
}

export interface ExecuteInspectResult {
  ok: boolean;
  task_id?: string;
  task?: Record<string, unknown>;
  error?: string;
  message?: string;
}

const sshUser = () => process.env.RL_PROXMOX_USER ?? 'rl-agent';
const sshHost = () => process.env.RL_PROXMOX_HOST ?? 'rl-infra';

function sshArgs(remote: string): [string, string[]] {
  return [
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser()}@${sshHost()}`, remote],
  ];
}

export async function execute(params: ExecuteInspectParams): Promise<ExecuteInspectResult> {
  // Defense-in-depth: validate BEFORE shell-interpolation. Zod at the MCP
  // boundary already enforces this — but the executor mustn't trust that.
  if (!TASK_ID_RE.test(params.task_id)) {
    return {
      ok: false,
      error: 'invalid_task_id',
      task_id: params.task_id,
    };
  }
  // Prefer the orchestrator binary so the path layout stays a VM-side
  // concern. Falls back to a direct cat if the binary is missing on an
  // un-redeployed VM. Either way, task_id is single-quoted via shellQuote
  // so the remote shell sees the literal bytes only.
  const remote =
    `/srv/rl-infra/orchestrator/bin/task-inspect ${shellQuote(params.task_id)} ` +
    `2>/dev/null || cat /srv/rl-infra/state/tasks/${shellQuote(params.task_id)}.json`;
  const [cmd, args] = sshArgs(remote);
  try {
    const { stdout } = await execFileP(cmd, args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15_000,
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return {
        ok: false,
        error: 'task not found',
        task_id: params.task_id,
      };
    }
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        error: 'failed_to_parse_response',
        task_id: params.task_id,
        message: trimmed.slice(0, 500),
      };
    }
    // Orchestrator may itself return {ok:false, error:"not_found"} on miss.
    if (parsed && parsed.ok === false) {
      return {
        ok: false,
        error: typeof parsed.error === 'string' ? parsed.error : 'task not found',
        task_id: params.task_id,
      };
    }
    return {
      ok: true,
      task_id: params.task_id,
      task: parsed,
    };
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number; stdout?: string };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    // Common case: file doesn't exist — `cat` exits 1 with "No such file…".
    // Surface as a structured not-found.
    if (/No such file or directory/i.test(stderr)) {
      return {
        ok: false,
        error: 'task not found',
        task_id: params.task_id,
      };
    }
    return {
      ok: false,
      error: 'task_inspect_failed',
      task_id: params.task_id,
      message: stderr,
    };
  }
}

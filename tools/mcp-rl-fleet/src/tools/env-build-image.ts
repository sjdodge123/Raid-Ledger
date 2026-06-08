// rl_env_build_image_from_runner — build allinone from the agent's branch.
//
// Invokes /srv/rl-infra/orchestrator/bin/build-image-on-runner over SSH.
// The orchestrator script resolves the agent's slot, then runs `docker
// build` INSIDE that runner — meaning the build sees the operator's
// branch via the Mutagen-synced /workspace, not the registry's `latest`.
//
// ROK-1331 M2: converted to default-async via task-start. wait:false (the
// default) dispatches and returns {task_id, log_url, started_at}; wait:true
// chains through task.executeWait. Bug C is NOT required here — the
// orchestrator binary is operator-installed on the VM with exec bits
// preserved, NOT a Mutagen-synced script.

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  buildSshArgs,
  deriveAgentId,
  shellQuote,
  synthesizeEmptyStderrDiagnostic,
} from '../exec.js';
import * as claim from './claim.js';
import * as task from './task.js';
import { isStillRunning, type StillRunningResult } from './task-schemas.js';
import { ensureSyncedHead } from '../sync-guard.js';

export const TOOL_NAME = 'rl_env_build_image_from_runner';
export const TOOL_DESCRIPTION =
  "Build an allinone Docker image from the agent's CURRENT BRANCH code (the Mutagen-synced /workspace inside the runner), tag it, and push to the local registry. ASYNC BY DEFAULT (wait:false) — returns {task_id, log_url, started_at} within 1s; poll via rl_task_status or block via rl_task_wait. Set wait:true to preserve the legacy synchronous shape. Build is 5–15 minutes on first run; subsequent rebuilds of the same branch are fast (Docker layer cache). Requires rl_claim first. When called from a worktree, pass worktree_path so the agent_id matches the slot you claimed. Before dispatching, a sync guard verifies the runner's /workspace actually reflects your laptop HEAD (force-resyncing a wedged Mutagen session once); if it can't confirm a current sync it returns error=\"sync_stuck\" and builds nothing rather than building stale source. The result includes expected_head + synced_head.";

export interface BuildImageParams {
  tag: string;
  no_push?: boolean;
  worktree_path?: string;
  timeout_seconds?: number;
  /** ROK-1331: default false (async). When true, chains to rl_task_wait. */
  wait?: boolean;
  /** Wait budget when wait:true. Default 1800. */
  wait_timeout_seconds?: number;
}

export interface BuildImageResult {
  ok: boolean;
  tag?: string;
  image?: string;
  slot?: number;
  duration_s?: number;
  pushed?: boolean;
  /** Async dispatch fields (wait:false). */
  task_id?: string;
  log_url?: string;
  log_path?: string;
  started_at?: string;
  mcp_runtime_status?: string;
  /** Laptop HEAD the build intends to use (sync guard). null for non-git worktrees. */
  expected_head?: string | null;
  /** HEAD confirmed present in the runner's /workspace (sync guard). Equals expected_head on a healthy build. */
  synced_head?: string | null;
  error?: string;
  stderr?: string;
  message?: string;
}

const FLEET_DOMAIN = process.env.RL_FLEET_DOMAIN ?? 'fleet.gamernight.net';

function execFileP(
  cmd: string,
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      const out =
        typeof stdout === 'string' ? stdout : (stdout as unknown as Buffer | undefined)?.toString() ?? '';
      const errStr =
        typeof stderr === 'string' ? stderr : (stderr as unknown as Buffer | undefined)?.toString() ?? '';
      if (err) {
        const e = err as Error & { stdout?: string; stderr?: string; code?: number };
        e.stdout = out;
        e.stderr = errStr || e.stderr || '';
        reject(e);
        return;
      }
      resolve({ stdout: out, stderr: errStr });
    });
  });
}

function newTaskId(): string {
  return randomBytes(6).toString('hex');
}

export async function execute(
  params: BuildImageParams,
): Promise<BuildImageResult | StillRunningResult> {
  // PRE-STEP: ensure the agent's Mutagen sync session is alive.
  const cl = await claim.execute({ worktree_path: params.worktree_path, wait: false });
  if (!cl.ok || cl.queued) {
    return {
      ok: false,
      error: 'pre_claim_failed',
      stderr: cl.error || cl.message || 'pre-build claim returned no slot',
    };
  }
  // SYNC GUARD (TECH-DEBT 2026-06-02). Verify the runner's Mutagen-synced
  // /workspace actually reflects the laptop's current HEAD BEFORE dispatching
  // the build. This replaces the old best-effort `mutagen sync flush` (which
  // swallowed errors and let a wedged session build stale source while
  // reporting ok). Lives in THIS primitive — not just rl_env_deploy — so the
  // standalone rl_env_build_image_from_runner + parallel-deploy paths are
  // covered too (Codex review 2026-06-02, high). On an unrecoverable stale/
  // wedged sync the guard force-resyncs once and, if still bad, we FAIL LOUD
  // here rather than building+pushing stale source.
  const guard = await ensureSyncedHead({
    slot: cl.slot as number,
    worktree_path: params.worktree_path,
  });
  if (!guard.ok) {
    return {
      ok: false,
      error: guard.error ?? 'sync_stuck',
      stderr: guard.message,
      expected_head: guard.expected_head,
      synced_head: guard.synced_head,
      slot: typeof cl.slot === 'number' ? cl.slot : undefined,
    };
  }
  const expectedHead = guard.expected_head;
  const syncedHead = guard.synced_head;

  const agentId = deriveAgentId(params.worktree_path);
  const wait = params.wait ?? false;
  // ROK-1362: executeWait clamps to 120s regardless; the default reflects that.
  const waitTimeoutS = params.wait_timeout_seconds ?? 120;

  const buildArgs = ['--tag', params.tag];
  if (params.no_push) buildArgs.push('--no-push');
  const quotedBuildArgs = buildArgs.map((a) => shellQuote(a)).join(' ');

  // Inner command: orchestrator's build binary with shellQuote'd args.
  // Bug C exemption: build-image-on-runner is operator-installed on the VM,
  // exec bits preserved; no `bash` wrap needed.
  const targetCmd = `/srv/rl-infra/orchestrator/bin/build-image-on-runner ${quotedBuildArgs}`;

  const taskId = newTaskId();
  const slot = typeof cl.slot === 'number' ? cl.slot : null;
  const slotFlag = slot !== null ? `--slot ${slot} ` : '';
  // ROK-1331 Session 4 dogfood (Codex P2-2): pass timeout_seconds through
  // to task-start so the watchdog kills hung docker builds. Default 1800
  // (30 min) — matches the legacy sync timeout. Builds can be long on
  // first-run; allow up to 2h via the param.
  const timeoutS = Math.max(60, Math.min(7200, params.timeout_seconds ?? 1800));
  const timeoutFlag = `--timeout-seconds ${timeoutS} `;
  const remote =
    `RL_AGENT_ID=${shellQuote(agentId)} ` +
    `/srv/rl-infra/orchestrator/bin/task-start ${shellQuote(taskId)} ` +
    `--tool rl_env_build_image_from_runner ${slotFlag}${timeoutFlag}` +
    `-- ${targetCmd}`;

  let dispatch: { task_id?: string; log_path?: string; started_at?: string } = {};
  try {
    const sshArgs = await buildSshArgs(remote);
    const { stdout } = await execFileP(
      'ssh',
      sshArgs,
      { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
    );
    try {
      dispatch = JSON.parse(stdout.trim()) as typeof dispatch;
    } catch {
      const last = stdout.trim().split('\n').pop();
      if (last) {
        try {
          dispatch = JSON.parse(last) as typeof dispatch;
        } catch {
          /* fall through */
        }
      }
    }
  } catch (err) {
    const e = err as Error & { stderr?: string; code?: number };
    const stderr =
      !e.stderr || e.stderr.trim() === ''
        ? synthesizeEmptyStderrDiagnostic(e.code)
        : e.stderr;
    return {
      ok: false,
      error: 'task_start_failed',
      stderr,
      expected_head: expectedHead,
      synced_head: syncedHead,
    };
  }

  const finalTaskId = dispatch.task_id ?? taskId;
  const startedAt = dispatch.started_at ?? new Date().toISOString();
  const logUrl = `https://${FLEET_DOMAIN}/api/tasks/${finalTaskId}/log`;

  if (!wait) {
    return {
      ok: true,
      task_id: finalTaskId,
      log_url: logUrl,
      log_path: dispatch.log_path ?? `/srv/rl-infra/state/tasks/${finalTaskId}.log`,
      started_at: startedAt,
      mcp_runtime_status: 'running',
      slot: slot ?? undefined,
      expected_head: expectedHead,
      synced_head: syncedHead,
    };
  }

  // wait:true — chain through executeWait and map TaskStatusResult fields
  // back to the legacy BuildImageResult shape so callers keep working.
  const status = await task.executeWait({
    task_id: finalTaskId,
    timeout_seconds: waitTimeoutS,
  });
  // ROK-1362 (Codex P2): the 120s cap can expire mid-build (builds run 5–15
  // min). That is NOT a failure — return the still_running snapshot VERBATIM
  // (with its `status:'still_running'` discriminator + progress fields) so the
  // caller can tell a cap-expiry from a build failure and re-poll from it.
  if (isStillRunning(status)) {
    return status;
  }
  if (status.mcp_runtime_status === 'succeeded') {
    return {
      ok: true,
      tag: params.tag,
      image: `registry.rl.lan:5000/rl-allinone:${params.tag}`,
      slot: slot ?? undefined,
      duration_s: status.elapsed_seconds,
      pushed: !params.no_push,
      task_id: finalTaskId,
      log_url: logUrl,
      started_at: startedAt,
      mcp_runtime_status: status.mcp_runtime_status,
      expected_head: expectedHead,
      synced_head: syncedHead,
    };
  }
  return {
    ok: false,
    error: 'build_image_failed',
    task_id: finalTaskId,
    log_url: logUrl,
    mcp_runtime_status: status.mcp_runtime_status ?? 'failed',
    stderr: status.message ?? status.error ?? 'build failed',
    expected_head: expectedHead,
    synced_head: syncedHead,
  };
}

// rl_env_build_image_from_runner — build allinone from the agent's branch.
//
// Invokes /srv/rl-infra/orchestrator/bin/build-image-on-runner over SSH.
// The orchestrator script resolves the agent's slot, then runs `docker
// build` INSIDE that runner — meaning the build sees the operator's
// branch via the Mutagen-synced /workspace, not the registry's `latest`.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deriveAgentId } from '../exec.js';

const execFileAsync = promisify(execFile);

export const TOOL_NAME = 'rl_env_build_image_from_runner';
export const TOOL_DESCRIPTION =
  "Build an allinone Docker image from the agent's CURRENT BRANCH code (the Mutagen-synced /workspace inside the runner), tag it, and push to the local registry. Returns the full image tag suitable for passing to rl_env_spin's `image` param. Default tag derived from the branch name when invoked through rl_env_deploy. Build is 5–15 minutes on first run; subsequent rebuilds of the same branch are fast (Docker layer cache). Requires rl_claim first. When called from a worktree, pass worktree_path so the agent_id matches the slot you claimed — otherwise the build won't find your slot.";

export interface BuildImageParams {
  /** Tag to use on the registry (e.g. "rok-1297"). Image becomes registry.rl.lan:5000/rl-allinone:<tag>. */
  tag: string;
  /** Skip the push step (build only). Defaults to false. */
  no_push?: boolean;
  /**
   * Absolute path to the agent's worktree — MUST match the worktree_path
   * passed to rl_claim. Used to derive RL_AGENT_ID consistently so this
   * build looks up YOUR claimed slot, not some other agent's.
   */
  worktree_path?: string;
  /** Soft timeout. Defaults to 1800 (30 min) — first-time builds need this. */
  timeout_seconds?: number;
}

export interface BuildImageResult {
  ok: boolean;
  /** The bare tag (e.g. "rok-1297"). */
  tag?: string;
  /** Full image ref ready for `rl_env_spin image=`. */
  image?: string;
  slot?: number;
  duration_s?: number;
  pushed?: boolean;
  error?: string;
  stderr?: string;
}

export async function execute(params: BuildImageParams): Promise<BuildImageResult> {
  const sshUser = process.env.RL_PROXMOX_USER ?? 'rl-agent';
  const sshHost = process.env.RL_PROXMOX_HOST ?? 'rl-infra';
  // Derive the same RL_AGENT_ID the rl CLI used when claiming the slot.
  // If worktree_path matches what was passed to rl_claim, the SHA matches
  // and the orchestrator finds the correct slot.
  const agentId = deriveAgentId(params.worktree_path);
  const timeoutMs = (params.timeout_seconds ?? 1800) * 1000;

  const args = ['--tag', params.tag];
  if (params.no_push) args.push('--no-push');
  const remote = `RL_AGENT_ID='${agentId}' /srv/rl-infra/orchestrator/bin/build-image-on-runner ${args.map((a) => JSON.stringify(a)).join(' ')}`;

  try {
    const result = await execFileAsync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`, remote],
      { maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs },
    );
    const parsed = JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}');
    return parsed as BuildImageResult;
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string; code?: number };
    return {
      ok: false,
      error: 'build_image_failed',
      stderr: e.stderr ?? e.message,
    };
  }
}

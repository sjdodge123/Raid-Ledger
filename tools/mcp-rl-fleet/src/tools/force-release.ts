// rl_force_release — operator-only override to clear a stuck slot.
//
// Unlike every other MCP tool in this server, this one elevates to the
// privileged `rl` user (via RlEnv.user override) and sets RL_OPERATOR=1.
// It's gated by RL_FLEET_ALLOW_FORCE_RELEASE=1 in the MCP server's env so
// it cannot be invoked from machines where the operator hasn't opted in.
//
// Use case: the operator (in a Claude Code session) needs to clear a slot
// owned by a wedged agent — heartbeat is stuck, gc-sweeper hasn't reaped
// yet, and the operator wants the slot back NOW.

import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_force_release';
export const TOOL_DESCRIPTION =
  "Operator-only: force-release a slot regardless of which agent claimed it. Tears down envs spun on that slot, drops the claim record, and removes the displaced agent from the queue. REQUIRES the MCP server to be started with RL_FLEET_ALLOW_FORCE_RELEASE=1 in its environment (operator's laptop opt-in) — refuses otherwise. Always pass a non-empty `reason` (recorded in the audit log). Use when an agent's heartbeat is stuck and the gc-sweeper hasn't reaped yet but you need the slot now.";

export interface ForceReleaseParams {
  /** Slot number to forcibly release. */
  slot: number;
  /** Required audit-trail reason. Recorded in /srv/rl-infra/state/audit.log. */
  reason: string;
  /** If true, drop the claim record but leave envs running. Default false. */
  no_destroy?: boolean;
}

export interface ForceReleaseResult {
  ok: boolean;
  slot?: number;
  prior_agent?: string | null;
  destroyed_envs?: string[];
  reason?: string;
  force_released?: boolean;
  error?: string;
  message?: string;
}

export async function execute(params: ForceReleaseParams): Promise<ForceReleaseResult> {
  if (process.env.RL_FLEET_ALLOW_FORCE_RELEASE !== '1') {
    return {
      ok: false,
      error: 'not_enabled',
      message:
        'rl_force_release is disabled. Set RL_FLEET_ALLOW_FORCE_RELEASE=1 in the MCP server env to enable.',
    };
  }
  if (!params.reason || params.reason.trim().length === 0) {
    return { ok: false, error: 'reason_required', message: 'reason is required (audit log)' };
  }

  const args = ['force-release', '--slot', String(params.slot), '--reason', params.reason];
  if (params.no_destroy) args.push('--no-destroy');

  // Elevate to the privileged `rl` user and set RL_OPERATOR=1 so the
  // orchestrator script's gate accepts the call. This is the ONLY tool in
  // this server that overrides the default rl-agent identity.
  const { stdout, stderr, exitCode } = await runRl(args, {
    user: 'rl',
    extra: { RL_OPERATOR: '1' },
  });
  const parsed = parseJsonFromStdout<ForceReleaseResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'parse_failed',
    message: stderr || stdout || `rl force-release exited ${exitCode}`,
  };
}

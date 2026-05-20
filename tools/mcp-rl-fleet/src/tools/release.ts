// rl_release — release the runner slot owned by the calling agent.
//
// ROK-1331 M5a — agent default PRESERVES envs (next claim on the same branch
// inherits them via lease-advance). Pass preserve_envs:false to force the
// legacy destroy-everything behavior.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_release';
export const TOOL_DESCRIPTION =
  "Release the runner slot held by this agent. ROK-1331 M5a: by default PRESERVES any env stacks the slot spun up — they're marked claimable_by_next on the env-registry so the next claim on the same branch inherits them (skip-deploy fast path). Branch-mismatch handoff destroys them synchronously inside lease-advance. Pass preserve_envs:false to force destroy-everything (legacy behavior; operator path). Idempotent: if the agent holds no slot, returns a noop. Pass worktree_path if you claimed from a worktree — otherwise the agent_id won't match and the release looks like a noop.";

export interface ReleaseParams {
  /** Same worktree_path used at rl_claim / rl_claim_wait time. Required for worktree-based agents. */
  worktree_path?: string;
  /**
   * Preserve envs across release so the next claim on the same branch can
   * inherit them (ROK-1331 M5a). Default `true` for agents. Set to `false`
   * to destroy envs immediately (operator path or explicit teardown).
   */
  preserve_envs?: boolean;
}

export interface ReleaseResult {
  ok: boolean;
  slot?: number;
  destroyed_envs?: string[];
  /**
   * ROK-1331 M5a — slugs whose containers are still running after this
   * release. When `preserve_envs` is true, this is the env-registry slugs
   * marked `claimable_by_next=true`. Empty when `preserve_envs:false`.
   */
  preserved_envs?: string[];
  /**
   * ROK-1331 M5a — true when an active claim was cleared (slot freed +
   * lease-advance fired). False on the no-op path (agent held no slot).
   */
  cleared_lease?: boolean;
  /**
   * Task IDs the orchestrator's `release` binary cascaded SIGTERM to. Empty
   * (never omitted) when no in-flight tasks were associated with this slot.
   * Source: M1 `release` binary's task-cancel cascade (ROK-1331 M2 AC4).
   */
  cancelled_tasks?: string[];
  message?: string;
  error?: string;
}

export async function execute(params: ReleaseParams = {}): Promise<ReleaseResult> {
  const args = ['release'];
  // Default preserve_envs to true for agents (matches the CLI's default).
  const preserve = params.preserve_envs ?? true;
  args.push(preserve ? '--preserve-envs' : '--destroy-envs');
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: params.worktree_path });
  const parsed = parseJsonFromStdout<ReleaseResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl release exited ${exitCode} with no parseable output`,
  };
}

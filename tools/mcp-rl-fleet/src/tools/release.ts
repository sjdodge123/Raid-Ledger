// rl_release — release the runner slot owned by the calling agent.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_release';
export const TOOL_DESCRIPTION =
  'Release the runner slot held by this agent. Destroys any env stacks the slot spun up, prunes scoped resources, drops the claim. Idempotent: if the agent holds no slot, returns a noop. Pass worktree_path if you claimed from a worktree — otherwise the agent_id won\'t match and the release looks like a noop.';

export interface ReleaseParams {
  /** Same worktree_path used at rl_claim time. Required for worktree-based agents. */
  worktree_path?: string;
}

export interface ReleaseResult {
  ok: boolean;
  slot?: number;
  destroyed_envs?: string[];
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
  const { stdout, stderr, exitCode } = await runRl(['release'], { cwd: params.worktree_path });
  const parsed = parseJsonFromStdout<ReleaseResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl release exited ${exitCode} with no parseable output`,
  };
}

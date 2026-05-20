// rl_env_destroy — tear down a per-test env.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_destroy';
export const TOOL_DESCRIPTION =
  "Destroy a per-test env: stops + removes the allinone container, removes the sibling Postgres container, deletes the rl-data-{slug} volume, removes the Traefik route file, drops the env-registry entry. The agent must own the slot the env was spun on (or pass force=true). Pass the same worktree_path you used at rl_claim time (and rl_claim_wait if you were enqueued) — without it the MCP server uses its own cwd and the agent_id hash won't match the claimed slot, forcing you into the force=true workaround (which defeats the ownership audit).";

export interface EnvDestroyResult {
  ok: boolean;
  slug?: string;
  error?: string;
  message?: string;
}

export interface EnvDestroyParams {
  slug: string;
  force?: boolean;
  /**
   * Absolute path to the agent's worktree. CRITICAL when calling from a
   * git worktree — without it the rl CLI runs in the MCP server's cwd
   * (usually the main repo) and the derived RL_AGENT_ID hashes against
   * the wrong path, so the ownership check fails and you can only proceed
   * via force=true. Use the same value you passed to rl_claim / rl_claim_wait / rl_env_spin.
   */
  worktree_path?: string;
}

export async function execute(params: EnvDestroyParams): Promise<EnvDestroyResult> {
  const args = ['env', 'destroy', '--slug', params.slug];
  if (params.force) args.push('--force');
  const { stdout, stderr, exitCode } = await runRl(args, { cwd: params.worktree_path });
  const parsed = parseJsonFromStdout<EnvDestroyResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env destroy exited ${exitCode}`,
  };
}

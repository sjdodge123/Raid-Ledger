// rl_env_list — list active per-test envs across all slots.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_list';
export const TOOL_DESCRIPTION =
  'List currently-running test envs on the fleet (regardless of which slot owns them). Returns slug, slot, ttl, last_touched, status. Lighter than rl_status when you only care about envs.';

export interface EnvListItem {
  container: string;
  slug: string | null;
  slot: string | null;
  ttl: string | null;
  last_touched: string | null;
  status: string;
  created: string;
}

export async function execute(): Promise<{ ok: boolean; envs: EnvListItem[]; error?: string }> {
  const { stdout, stderr, exitCode } = await runRl(['status']);
  const parsed = parseJsonFromStdout<{ envs?: EnvListItem[] }>(stdout);
  if (parsed && Array.isArray(parsed.envs)) {
    return { ok: true, envs: parsed.envs };
  }
  return {
    ok: false,
    envs: [],
    error: stderr || stdout || `rl status exited ${exitCode}`,
  };
}

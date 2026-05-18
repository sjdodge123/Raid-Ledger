// rl_release — release the runner slot owned by the calling agent.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_release';
export const TOOL_DESCRIPTION =
  'Release the runner slot held by this agent. Destroys any env stacks the slot spun up, prunes scoped resources, drops the claim. Idempotent: if the agent holds no slot, returns a noop.';

export interface ReleaseResult {
  ok: boolean;
  slot?: number;
  destroyed_envs?: string[];
  message?: string;
  error?: string;
}

export async function execute(): Promise<ReleaseResult> {
  const { stdout, stderr, exitCode } = await runRl(['release']);
  const parsed = parseJsonFromStdout<ReleaseResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl release exited ${exitCode} with no parseable output`,
  };
}

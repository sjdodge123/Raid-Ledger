// rl_env_destroy — tear down a per-test env.
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_destroy';
export const TOOL_DESCRIPTION =
  'Destroy a per-test env: stops + removes the allinone container, removes the sibling Postgres container, deletes the rl-data-{slug} volume, removes the Traefik route file, drops the env-registry entry. The agent must own the slot the env was spun on (or pass force=true).';

export interface EnvDestroyResult {
  ok: boolean;
  slug?: string;
  error?: string;
  message?: string;
}

export interface EnvDestroyParams {
  slug: string;
  force?: boolean;
}

export async function execute(params: EnvDestroyParams): Promise<EnvDestroyResult> {
  const args = ['env', 'destroy', '--slug', params.slug];
  if (params.force) args.push('--force');
  const { stdout, stderr, exitCode } = await runRl(args);
  const parsed = parseJsonFromStdout<EnvDestroyResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env destroy exited ${exitCode}`,
  };
}

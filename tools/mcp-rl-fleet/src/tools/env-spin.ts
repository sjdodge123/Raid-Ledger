// rl_env_spin — bring up a per-test env (allinone + sibling Postgres).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_spin';
export const TOOL_DESCRIPTION =
  'Spin a per-test environment on the fleet: pulls the allinone image, starts a sibling Postgres + the app container, registers the route in Traefik. Returns the URL the test env answers at (http://{slug}.rl.lan). Slug must match [a-z0-9-]+. Idempotent: if an env with this slug already exists, refreshes last_touched and returns the URL.';

export interface EnvSpinResult {
  ok: boolean;
  idempotent?: boolean;
  slug?: string;
  url?: string;
  slot?: number;
  app_container?: string;
  pg_container?: string;
  error?: string;
  message?: string;
}

export interface EnvSpinParams {
  slug: string;
  image?: string;
  ttl_hours?: number;
}

export async function execute(params: EnvSpinParams): Promise<EnvSpinResult> {
  // CLI forwards args verbatim to /srv/rl-infra/orchestrator/bin/env-spin
  // which expects --slug/--image/--ttl flags (not positional). Pass --slug.
  const args = ['env', 'spin', '--slug', params.slug];
  if (params.image) args.push('--image', params.image);
  if (params.ttl_hours) args.push('--ttl', String(params.ttl_hours));

  const { stdout, stderr, exitCode } = await runRl(args);
  const parsed = parseJsonFromStdout<EnvSpinResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env spin exited ${exitCode}`,
  };
}

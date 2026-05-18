// rl_env_spin — bring up a per-test env (allinone + sibling Postgres).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_spin';
export const TOOL_DESCRIPTION =
  "Spin a per-test environment on the fleet: pulls the allinone image, starts a sibling Postgres + the app container, registers the Traefik route. Returns three URLs: `url` (the canonical/shareable one — external if RL_PUBLIC_DOMAIN is set, internal otherwise), `internal_url` (always http://{slug}.rl.lan for LAN fallback), and `public_url` (https://{slug}test.{RL_PUBLIC_DOMAIN} or null). Send `url` to testers — it works on LAN (via Pi-hole short-circuit) AND off LAN (via Cloudflare→NPM). Slug must match [a-z0-9-]+. Idempotent: if env exists, refreshes last_touched and returns URLs.";

export interface EnvSpinResult {
  ok: boolean;
  idempotent?: boolean;
  slug?: string;
  /** Canonical/shareable URL. Equals public_url when RL_PUBLIC_DOMAIN is set, else internal_url. */
  url?: string;
  /** Always http://{slug}.rl.lan — LAN-only fallback. */
  internal_url?: string;
  /** External URL (https://{slug}test.{RL_PUBLIC_DOMAIN}) or null if RL_PUBLIC_DOMAIN unset. */
  public_url?: string | null;
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

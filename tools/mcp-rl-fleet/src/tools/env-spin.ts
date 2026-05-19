// rl_env_spin — bring up a per-test env (allinone + sibling Postgres).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_spin';
export const TOOL_DESCRIPTION =
  "Spin a per-test environment on the fleet: pulls the allinone image, starts a sibling Postgres + the app container, registers the Traefik route, seeds the admin@local user with a known password. Returns FOUR URLs (`url` canonical/shareable, `internal_url` LAN, `public_url` https://{slug}test.{RL_PUBLIC_DOMAIN}, `slot_url` https://slot-N.{RL_PUBLIC_DOMAIN} — STABLE per slot for Discord OAuth) PLUS admin credentials (`admin_email`, `admin_password` — comes from RL_ADMIN_PASSWORD in /srv/rl-infra/.env if set, else generated per-call). POST {email, password} to {url}/api/auth/local to get a JWT for admin API calls. Send `url` to testers; use `slot_url` for Discord login flows. Slug must match [a-z0-9-]+. Idempotent: re-spinning re-seeds the admin password (same value if RL_ADMIN_PASSWORD is set; fresh random otherwise).";

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
  /**
   * Slot-stable URL (https://slot-N.{RL_PUBLIC_DOMAIN}). ROK-1324 — Discord
   * OAuth requires redirect URIs to be registered once in the developer
   * portal, so per-slug URLs can't work for "Continue with Discord".
   * The slot URL is registered once per slot and routes to whatever env
   * is currently on that slot. Hand this to testers for login flows.
   * Null when RL_PUBLIC_DOMAIN is unset (local/LAN mode).
   */
  slot_url?: string | null;
  slot?: number;
  /** Admin email for /api/auth/local. Always "admin@local" in DEMO_MODE envs. */
  admin_email?: string;
  /**
   * Admin password seeded into the env's local_credentials by env-spin.
   * If `RL_ADMIN_PASSWORD` is set in `/srv/rl-infra/.env`, every env gets
   * the same password (stable across deploys / slugs). Otherwise a random
   * 16-char hex string is generated per call. Null only if the bootstrap
   * step itself failed (rare — would indicate the allinone wasn't healthy
   * yet at the bootstrap-admin exec). Use to POST to {url}/api/auth/local
   * for a JWT.
   */
  admin_password?: string | null;
  app_container?: string;
  pg_container?: string;
  error?: string;
  message?: string;
}

export interface EnvSpinParams {
  slug: string;
  image?: string;
  ttl_hours?: number;
  /** Same worktree_path used at rl_claim time. */
  worktree_path?: string;
}

export async function execute(params: EnvSpinParams): Promise<EnvSpinResult> {
  // CLI forwards args verbatim to /srv/rl-infra/orchestrator/bin/env-spin
  // which expects --slug/--image/--ttl flags (not positional). Pass --slug.
  const args = ['env', 'spin', '--slug', params.slug];
  if (params.image) args.push('--image', params.image);
  if (params.ttl_hours) args.push('--ttl', String(params.ttl_hours));

  const { stdout, stderr, exitCode } = await runRl(args, { cwd: params.worktree_path });
  const parsed = parseJsonFromStdout<EnvSpinResult>(stdout);
  if (parsed) return parsed;
  return {
    ok: false,
    error: 'failed_to_parse_response',
    message: stderr || stdout || `rl env spin exited ${exitCode}`,
  };
}

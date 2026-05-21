// rl_env_spin — bring up a per-test env (allinone + sibling Postgres).
import { runRl, parseJsonFromStdout } from '../exec.js';

export const TOOL_NAME = 'rl_env_spin';
export const TOOL_DESCRIPTION =
  "Spin a per-test environment on the fleet: pulls the allinone image, starts a sibling Postgres + the app container, registers the Traefik route, seeds the admin@local user with a known password. **ALWAYS use the `url` field for any tester-facing link, agent navigation, test_url in plans, etc.** — it points at the slot-stable hostname (https://slot-N.{RL_PUBLIC_DOMAIN}) which routes to the same env AND supports Discord OAuth (registered redirect URI). The per-slug `public_url` (https://{slug}test.{RL_PUBLIC_DOMAIN}) is kept in the response for backward compat but should NOT be sent to testers — Discord login won't work on it. Also returns: `internal_url` (LAN fallback http://{slug}.rl.lan), `admin_email`, `admin_password` (from RL_ADMIN_PASSWORD in /srv/rl-infra/.env if set, else generated). POST {email, password} to {url}/api/auth/local for a JWT. Slug must match [a-z0-9-]+. Idempotent.";

export interface EnvSpinResult {
  ok: boolean;
  idempotent?: boolean;
  slug?: string;
  /**
   * Canonical/shareable URL — ALWAYS use this. When RL_PUBLIC_DOMAIN is
   * set, this is the SLOT URL (https://slot-N.{RL_PUBLIC_DOMAIN}), not
   * the per-slug one. Slot URL routes to the same env AND supports
   * Discord OAuth. Falls back to public_url then internal_url when
   * the slot URL isn't available.
   */
  url?: string;
  /** Always http://{slug}.rl.lan — LAN-only fallback. */
  internal_url?: string;
  /**
   * Per-slug external URL (https://{slug}test.{RL_PUBLIC_DOMAIN}). Kept
   * in the response for backward compat but DO NOT hand this out —
   * Discord OAuth won't accept it (callback URI is registered against
   * slot URLs only). Prefer `url` everywhere.
   */
  public_url?: string | null;
  /**
   * Same as `url` when RL_PUBLIC_DOMAIN is set. Kept as a separate field
   * for code that explicitly wants the slot-form (e.g. constructing
   * other slot-based hostnames). Most callers just use `url`.
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
  /**
   * HO-2 (ROK-1326): non-fatal warnings surfaced from the env-spin pipeline.
   * Currently emits one entry on admin-bootstrap failure (code:
   * `admin_bootstrap_failed`, detail: tail of the bootstrap-admin script's
   * stderr). The env itself is still healthy when this is non-empty —
   * `admin_password` will be null and the caller must fall back to
   * DEMO_MODE bypass for login. Empty array on the happy path.
   */
  bootstrap_warnings?: Array<{ code: string; detail: string }>;
  /**
   * HO-8 (ROK-1326): true iff this env owns the slot-N.${RL_PUBLIC_DOMAIN}
   * Traefik Host rule (i.e. the OAuth callback hostname resolves to THIS
   * env). When false, another env on the same slot got there first; this
   * env is reachable only via the per-slug public URL. False when
   * RL_PUBLIC_DOMAIN is unset (the slot URL concept doesn't apply on the
   * LAN-only topology).
   */
  is_slot_owner?: boolean;
  /**
   * HO-8 (ROK-1326): true iff Discord OAuth (callback URI registered
   * against slot-N.${RL_PUBLIC_DOMAIN}) will route to THIS env. Same as
   * is_slot_owner today but kept as a separate field so future OAuth
   * topology changes (e.g. per-env callback URIs) can decouple the two.
   */
  slot_oauth_available?: boolean;
  error?: string;
  message?: string;
  /**
   * ROK-1338 PR-1 (2026-05-21): diagnostic fields emitted by env-spin's
   * orchestrator-side error paths. Populated only when `ok === false`.
   *
   * `phase` — which structured-error branch fired:
   *   - `"register_new"` — state::mutate failed appending a new slug
   *   - `"register_idempotent"` — state::mutate failed upserting an existing slug
   *   - undefined when error is `"env_spin_aborted_unexpectedly"` (EXIT trap caught a `set -e` abort before either guarded branch ran — exit_code identifies the failing line via bash -x)
   *
   * `exit_code` — non-zero exit code captured by the EXIT trap. Absent for
   * the two `register_*` branches (they exit 1 by their own logic).
   *
   * `hint` — human-readable next-step pointer. Tells the operator how to
   * investigate (bash -x command, file paths to check, etc).
   */
  phase?: 'register_new' | 'register_idempotent';
  exit_code?: number;
  hint?: string;
}

export interface EnvSpinParams {
  slug: string;
  image?: string;
  ttl_hours?: number;
  /** Same worktree_path used at rl_claim time (or rl_claim_wait if enqueued). */
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

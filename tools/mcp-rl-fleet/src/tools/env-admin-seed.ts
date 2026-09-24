// ROK-1368 re-seed helper, extracted from validate-ci.ts so rl_env_signin_link
// can obtain the env admin password the same way rl_validate_ci does — the
// value never leaves the MCP server process.
import { execFileP } from './runner-git.js';

// ROK-1368: re-assert admin@local in the spun env to a KNOWN password and
// return it, so Playwright's global-setup (scripts/playwright-global-setup.ts,
// `ADMIN_PASSWORD || 'password'`) authenticates against the fleet env. env-spin
// seeds the env admin from RL_ADMIN_PASSWORD (or a random rl-<hex>) and only
// RETURNS the plaintext — it never persists it keyed by slug, so the harness
// can't look it up later. We re-seed via the rl-docker-proxy (the loopback-2375
// `docker exec` path rl_env_inspect already uses), preferring RL_ADMIN_PASSWORD
// so a tester's password stays stable, else a fresh rl-ci-<hex>. bootstrap-admin
// is idempotent (RESET_PASSWORD=true). Returns null on ANY failure — the caller
// then omits ADMIN_PASSWORD and global-setup keeps today's fallback behavior
// (fail-safe, never blocks the dispatch). slug is regex-gated [a-z0-9-]+ at the
// MCP boundary, so interpolation into the remote string is safe.
export async function seedEnvAdminPassword(
  sshUser: string,
  sshHost: string,
  slug: string,
): Promise<string | null> {
  const container = `rl-env-${slug}-allinone`;
  const remote =
    `PW="$(grep -E '^RL_ADMIN_PASSWORD=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2-)"; ` +
    `[ -z "$PW" ] && PW="rl-ci-$(openssl rand -hex 8)"; ` +
    `DOCKER_HOST=tcp://127.0.0.1:2375 docker exec ` +
    `-e ADMIN_PASSWORD="$PW" -e RESET_PASSWORD=true ${container} ` +
    `node /app/dist/scripts/bootstrap-admin.js >/dev/null 2>&1 && ` +
    `printf 'RL_SEEDED_PW=%s' "$PW"`;
  try {
    const { stdout } = await execFileP(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `${sshUser}@${sshHost}`, remote],
      { maxBuffer: 1024 * 1024, timeout: 30_000 },
    );
    const m = stdout.match(/RL_SEEDED_PW=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

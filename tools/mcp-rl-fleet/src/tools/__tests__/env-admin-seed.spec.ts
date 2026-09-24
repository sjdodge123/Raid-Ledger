// env-admin-seed — rl_validate_ci's remote string stays byte-identical; the
// requireFixed variant (rl_env_signin_link) never rotates to a random password.
import { describe, it, expect, vi } from 'vitest';
import { buildSeedRemote, seedFixedEnvAdminPassword } from '../env-admin-seed.js';

// Verbatim remote from before the requireFixed split (slug rok-1).
const LEGACY_REMOTE = "PW=\"$(grep -E '^RL_ADMIN_PASSWORD=' /srv/rl-infra/.env 2>/dev/null | head -1 | cut -d= -f2-)\"; [ -z \"$PW\" ] && PW=\"rl-ci-$(openssl rand -hex 8)\"; DOCKER_HOST=tcp://127.0.0.1:2375 docker exec -e ADMIN_PASSWORD=\"$PW\" -e RESET_PASSWORD=true rl-env-rok-1-allinone node /app/dist/scripts/bootstrap-admin.js >/dev/null 2>&1 && printf 'RL_SEEDED_PW=%s' \"$PW\"";

describe('buildSeedRemote', () => {
  it('default (rl_validate_ci) form is byte-identical to the pre-split string', () => {
    expect(buildSeedRemote('rok-1')).toBe(LEGACY_REMOTE);
  });

  it('requireFixed form has no random fallback and exits when RL_ADMIN_PASSWORD is empty', () => {
    const remote = buildSeedRemote('rok-1', true);
    expect(remote).not.toContain('openssl rand');
    expect(remote).not.toContain('rl-ci-');
    expect(remote).toContain(`[ -z "$PW" ] && { printf 'RL_NO_FIXED_PW'; exit 3; }; `);
  });
});

describe('seedFixedEnvAdminPassword', () => {
  it('returns the stable password on success, using the requireFixed remote', async () => {
    const run = vi.fn(async () => 'RL_SEEDED_PW=stable-pw');
    const res = await seedFixedEnvAdminPassword('u', 'h', 'rok-1', run);
    expect(res).toEqual({ ok: true, password: 'stable-pw' });
    expect(run).toHaveBeenCalledWith('u', 'h', buildSeedRemote('rok-1', true));
  });

  it('maps the RL_NO_FIXED_PW marker to no_fixed_password', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('exit 3'), { stdout: 'RL_NO_FIXED_PW' });
    });
    expect(await seedFixedEnvAdminPassword('u', 'h', 'rok-1', run)).toEqual({ ok: false, reason: 'no_fixed_password' });
  });

  it('maps any other failure to seed_failed', async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error('ssh down'), { stdout: '' });
    });
    expect(await seedFixedEnvAdminPassword('u', 'h', 'rok-1', run)).toEqual({ ok: false, reason: 'seed_failed' });
    expect(await seedFixedEnvAdminPassword('u', 'h', 'rok-1', async () => '')).toEqual({ ok: false, reason: 'seed_failed' });
  });
});

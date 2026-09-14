// ROK-1565 — rl_validate_ci forwards the Playwright scope to the runner.
//
// The fleet gate exists to catch YOUR break early; GitHub re-runs the whole
// suite before the merge. So the runner should normally run only the specs
// covering the surfaces the diff touched (`scripts/smoke/scope-specs.sh`), and
// an agent must be able to say `none` (static only) or `all` (paranoid
// pre-push) without hand-assembling an env prefix.
//
// The seam is the env prefix `execute()` builds for the remote command, so
// these are pure-function specs — no SSH.
import { describe, it, expect } from 'vitest';
import { resolveInnerEnv } from '../tools/validate-ci.js';

describe('resolveInnerEnv — e2e_scope (ROK-1565)', () => {
  it('stays empty when neither a target nor a scope is given', () => {
    expect(resolveInnerEnv({})).toBe('');
  });

  it('exports E2E_SCOPE even when there is no base_url', () => {
    // A `--static` run has no target but may still want to pin the scope for
    // the summary row (and for a later --with-e2e re-run of the same command).
    expect(resolveInnerEnv({ e2eScope: 'none' })).toMatch(/^E2E_SCOPE='?none'? $/);
  });

  it('exports E2E_SCOPE alongside the target variables', () => {
    const env = resolveInnerEnv({ baseUrl: 'https://slot-3.gamernight.net', e2eScope: 'auto' });

    expect(env).toContain('BASE_URL=');
    expect(env).toContain('API_URL=');
    expect(env).toContain('HEALTH_URL=');
    expect(env).toMatch(/E2E_SCOPE='?auto'?/);
    expect(env.endsWith(' ')).toBe(true);
  });

  it('omits E2E_SCOPE when the caller did not ask for one', () => {
    expect(resolveInnerEnv({ baseUrl: 'https://slot-3.gamernight.net' })).not.toContain(
      'E2E_SCOPE',
    );
  });

  it('accepts all three documented values', () => {
    for (const scope of ['auto', 'all', 'none'] as const) {
      expect(resolveInnerEnv({ e2eScope: scope })).toContain('E2E_SCOPE=');
    }
  });
});

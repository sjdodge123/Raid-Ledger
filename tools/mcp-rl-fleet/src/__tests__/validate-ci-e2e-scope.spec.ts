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
import {
  checkE2eSpecs,
  E2E_SPEC_PATTERN,
  MAX_E2E_SPECS,
  resolveArgs,
  resolveInnerEnv,
} from '../tools/validate-ci.js';
import { playwrightRowStatus } from '../gate-summary.js';

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

// ROK-1792 — an explicit spec list. The CLAUDE.md gate rule (fleet = --static +
// only the branch's new/changed specs) needs a path list E2E_SCOPE's enum
// cannot carry. These pin the boundary validation (pattern, cap, mutual
// exclusion) and the shell-quoted E2E_SPECS the runner receives.
describe('e2e_specs (ROK-1792)', () => {
  const A = 'scripts/smoke/games.smoke.spec.ts';
  const B = 'scripts/smoke/players.smoke.spec.ts';

  it('exports E2E_SPECS as ONE shell-quoted, space-separated value', () => {
    const env = resolveInnerEnv({ baseUrl: 'https://slot-3.gamernight.net', e2eSpecs: [A, B] });

    expect(env).toContain(`E2E_SPECS='${A} ${B}' `);
    expect(env).toContain('BASE_URL=');
  });

  it('omits E2E_SPECS for an absent or empty list', () => {
    expect(resolveInnerEnv({})).not.toContain('E2E_SPECS');
    expect(resolveInnerEnv({ e2eSpecs: [] })).not.toContain('E2E_SPECS');
  });

  it('accepts well-formed smoke spec paths', () => {
    expect(checkE2eSpecs([A, B], undefined)).toBeNull();
    expect(checkE2eSpecs([A], 'auto', ['--only-e2e'])).toBeNull();
    expect(checkE2eSpecs(undefined, 'none')).toBeNull();
    expect(checkE2eSpecs([], 'all')).toBeNull();
  });

  it('the pattern rejects anything outside scripts/smoke/*.spec.ts or with a shell metachar', () => {
    for (const bad of [
      'web/src/App.tsx',
      'scripts/smoke/helpers.ts',
      '/scripts/smoke/a.spec.ts',
      'scripts/smoke/a.spec.ts; rm -rf /',
      "scripts/smoke/a'.spec.ts",
      'scripts/smoke/$(id).spec.ts',
      // Codex P2: Vitest files under scripts/smoke that Playwright's testMatch
      // (/\.smoke\.spec\.ts$/) never selects, and glob patterns.
      'scripts/smoke/console-filter.spec.ts',
      'scripts/smoke/*.smoke.spec.ts',
      'scripts/smoke/game?.smoke.spec.ts',
      'scripts/smoke/[a-z].smoke.spec.ts',
    ]) {
      expect(E2E_SPEC_PATTERN.test(bad), bad).toBe(false);
      expect(checkE2eSpecs([bad], undefined), bad).toMatch(/must match scripts\/smoke/);
    }
  });

  it("rejects a '..' segment the character class would otherwise admit", () => {
    const sneaky = 'scripts/smoke/../../api/src/x.smoke.spec.ts';
    expect(E2E_SPEC_PATTERN.test(sneaky)).toBe(true);
    expect(checkE2eSpecs([sneaky], undefined)).toMatch(/no '\.\.'/);
  });

  it(`caps the list at ${MAX_E2E_SPECS} paths`, () => {
    const many = Array.from({ length: MAX_E2E_SPECS + 1 }, (_, i) => `scripts/smoke/s${i}.smoke.spec.ts`);
    expect(checkE2eSpecs(many.slice(0, MAX_E2E_SPECS), undefined)).toBeNull();
    expect(checkE2eSpecs(many, undefined)).toMatch(/at most 20 paths \(got 21\)/);
  });

  it("is mutually exclusive with e2e_scope 'all' / 'none'", () => {
    expect(checkE2eSpecs([A], 'all')).toMatch(/e2e_scope:'all' are mutually exclusive/);
    expect(checkE2eSpecs([A], 'none')).toMatch(/e2e_scope:'none' are mutually exclusive/);
  });

  it('is rejected with --static / --no-e2e, which never run Playwright', () => {
    expect(checkE2eSpecs([A], undefined, ['--static'])).toMatch(/--static are mutually exclusive/);
    expect(checkE2eSpecs([A], undefined, ['--no-e2e'])).toMatch(/--no-e2e are mutually exclusive/);
  });

  it('is rejected with every other mode that bypasses Playwright (Codex P2)', () => {
    for (const flag of ['--only-unit', '--only-integration', '--contrast-audit']) {
      expect(checkE2eSpecs([A], undefined, ['--only-e2e', flag]), flag).toMatch(
        new RegExp(`${flag} are mutually exclusive`),
      );
    }
  });

  it('is rejected via the only_unit / only_integration convenience booleans too', () => {
    for (const p of [{ only_unit: true }, { only_integration: true }]) {
      const args = resolveArgs({ e2e_specs: [A], ...p });
      expect(checkE2eSpecs([A], undefined, args), JSON.stringify(p)).toMatch(/--only-\w+ are mutually exclusive/);
    }
  });

  it('keeps the explicit row label a Playwright row, so a PASS writes the sentinel', () => {
    const tail = [
      '=== Summary ===',
      'Playwright (desktop + mobile, explicit: 2 specs)  PASS',
    ].join('\n');
    expect(playwrightRowStatus(tail)).toBe('PASS');
  });
});

// A3-B fix 2 — the docs must not promise a field the boundary now withholds.
//
// A3-B P4 made `admin_password` opt-in across the five carrier surfaces, but
// rl-infra/README.md still listed it as a plain return value of `rl_env_spin`
// ("returns it in `admin_password` deterministically across calls"). A doc that
// promises a withheld field is the same lying-description class this branch
// exists to remove: an agent reads it, expects the value, gets a bare
// `admin_password_available` and has no idea the opt-in flag exists.
//
// This guard scans the README only (never itself), so it cannot trip on its own
// explanatory prose the way source-scanning guards have before.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Repo root = four levels up from tools/mcp-rl-fleet/src/__tests__. */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

/** Terms that prove a line describes the CURRENT opt-in contract. */
const OPT_IN_MARKERS = /admin_password_available|include_credentials|withheld|not returned by default/;

/**
 * `git grep -n` for a pattern, scoped to `paths`. Empty list when nothing matches.
 *
 * @param pattern - An extended-regex passed to `git grep -E`.
 * @param paths - Pathspecs to scope the search to.
 * @returns One `path:line:text` entry per match.
 */
function gitGrep(pattern: string, paths: string[]): string[] {
  try {
    const out = execSync(`git grep -nE '${pattern}' -- ${paths.map((p) => `'${p}'`).join(' ')}`, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    return out.split('\n').filter(Boolean);
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return (e.stdout ?? '').split('\n').filter(Boolean);
    throw err;
  }
}

describe('A3-B fix 2 — rl-infra/README.md credential contract', () => {
  it('every admin_password mention describes the opt-in, not a plain returned field', () => {
    const lines = gitGrep('admin_password', ['rl-infra/README.md']);
    expect(
      lines.length,
      'the guard found NO admin_password lines at all — the pathspec or the README moved, ' +
        'so this test would pass vacuously. Fix the guard, do not delete it.',
    ).toBeGreaterThan(0);

    const offenders = lines.filter((line) => !OPT_IN_MARKERS.test(line));
    expect(
      offenders,
      `rl-infra/README.md still promises admin_password as a plain return value. Each line ` +
        `below must name the opt-in (include_credentials / admin_password_available / withheld) ` +
        `— expected [], got ${offenders.length} offender(s):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the README names the opt-in flag by its exact parameter name', () => {
    const lines = gitGrep('include_credentials', ['rl-infra/README.md']);
    expect(
      lines.length,
      'an agent that reads only the README must be able to find the opt-in flag — ' +
        `expected at least one "include_credentials" mention, got ${lines.length}`,
    ).toBeGreaterThan(0);
  });
});

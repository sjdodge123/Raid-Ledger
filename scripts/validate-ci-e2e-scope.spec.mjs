// node:test spec for validate-ci.sh's ROK-1565 Playwright scoping.
//
// Why this exists: the fleet gate's unique value is its 4-minute static tier.
// A measured 2026-09-14 run spent 15-25 min in the Playwright tier of a 5-line
// web fix and found nothing GitHub's full suite would not have found 45 min
// later. So the tier now runs only the specs `scripts/smoke/scope-specs.sh`
// maps the branch diff to, and E2E_SCOPE (forwarded by rl_validate_ci) can
// force `all` or `none`.
//
// Two things are pinned here because breaking either is silent:
//   * the scoped summary row STILL starts with `Playwright (desktop + mobile`
//     — the pre-push sentinel parser and the CI greps key on that prefix,
//   * anything that is not a confident scoped list (ALL, an unreadable script,
//     a non-auto scope) falls back to the FULL suite. Failing toward more
//     coverage is the only safe direction for a gate.
//
// Functions are extracted from the script rather than sourced: validate-ci.sh
// runs its main flow on source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'validate-ci.sh');

/** A function body, lifted out of validate-ci.sh verbatim. */
function extractFunction(name) {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated ${name} in validate-ci.sh`);
  return src.slice(start, end + 3);
}

/**
 * Run the scope resolver in a throwaway repo root whose scope-specs.sh is a
 * stub printing `stubOut` and exiting `stubCode`.
 * Returns { label, specs, count }.
 */
function prepare({ stubOut = 'ALL', stubCode = 0, scope, e2eMode = 'auto', noScript = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-scope-'));
  try {
    mkdirSync(join(root, 'scripts', 'smoke'), { recursive: true });
    const stub = join(root, 'scripts', 'smoke', 'scope-specs.sh');
    if (!noScript) {
      const emit = stubOut ? `cat <<'SPECS'\n${stubOut}\nSPECS\n` : '';
      writeFileSync(stub, `#!/usr/bin/env bash\n${emit}exit ${stubCode}\n`);
      chmodSync(stub, 0o755);
    }

    const script = [
      'set -uo pipefail',
      `REPO_ROOT=${JSON.stringify(root)}`,
      'YELLOW=""; NC=""',
      `e2e_mode=${JSON.stringify(e2eMode)}`,
      scope === undefined ? 'unset E2E_SCOPE || true' : `export E2E_SCOPE=${JSON.stringify(scope)}`,
      'PLAYWRIGHT_STEP_LABEL="Playwright (desktop + mobile)"',
      'PLAYWRIGHT_SCOPED_SPECS=""',
      'E2E_SCOPE_RESOLVED=""',
      extractFunction('_resolve_e2e_scope'),
      extractFunction('_scoped_playwright_specs'),
      extractFunction('_prepare_playwright_scope'),
      '_prepare_playwright_scope >/dev/null 2>&1',
      'echo "LABEL=$PLAYWRIGHT_STEP_LABEL"',
      'echo "SPECS=$(echo $PLAYWRIGHT_SCOPED_SPECS)"',
    ].join('\n');

    const stdout = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    const label = /^LABEL=(.*)$/m.exec(stdout)?.[1] ?? '';
    const specs = (/^SPECS=(.*)$/m.exec(stdout)?.[1] ?? '').trim();
    return { label, specs, count: specs ? specs.split(/\s+/).length : 0 };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The resolved E2E_SCOPE for a given environment value. */
function resolveScope(value, { times = 1 } = {}) {
  const script = [
    'set -uo pipefail',
    'YELLOW=""; NC=""',
    'E2E_SCOPE_RESOLVED=""',
    value === undefined ? 'unset E2E_SCOPE || true' : `export E2E_SCOPE=${JSON.stringify(value)}`,
    extractFunction('_resolve_e2e_scope'),
    ...Array.from({ length: times }, () => '_resolve_e2e_scope'),
  ].join('\n');
  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return out.trim().split('\n').pop();
}

/** stderr from calling the resolver `times` times in ONE shell. */
function resolveScopeWarnings(value, times) {
  const script = [
    'set -uo pipefail',
    'YELLOW=""; NC=""',
    'E2E_SCOPE_RESOLVED=""',
    `export E2E_SCOPE=${JSON.stringify(value)}`,
    extractFunction('_resolve_e2e_scope'),
    ...Array.from({ length: times }, () => '_resolve_e2e_scope >/dev/null'),
  ].join('\n');
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return res.stderr.split('\n').filter((l) => l.includes('Unrecognised E2E_SCOPE')).length;
}

test('E2E_SCOPE defaults to auto and passes the documented values through', () => {
  assert.equal(resolveScope(undefined), 'auto');
  assert.equal(resolveScope(''), 'auto');
  assert.equal(resolveScope('auto'), 'auto');
  assert.equal(resolveScope('all'), 'all');
  assert.equal(resolveScope('none'), 'none');
});

test('an unrecognised E2E_SCOPE falls back to auto rather than skipping', () => {
  assert.equal(resolveScope('nope'), 'auto');
});

test('the resolution is memoized — the typo warning is printed once per run', () => {
  assert.equal(resolveScope('nope', { times: 3 }), 'auto');
  assert.equal(resolveScopeWarnings('nope', 3), 1);
});

test('a scoped auto run names the specs in the summary row, keeping the prefix', () => {
  const { label, count } = prepare({
    stubOut: 'scripts/smoke/games.smoke.spec.ts\nscripts/smoke/players.smoke.spec.ts',
  });

  assert.ok(
    label.startsWith('Playwright (desktop + mobile'),
    `the sentinel parser keys on that prefix; got ${label}`,
  );
  assert.equal(label, 'Playwright (desktop + mobile, scoped: 2 specs)');
  assert.equal(count, 2);
});

test('ALL from scope-specs.sh means the full suite and the unscoped row', () => {
  const { label, specs } = prepare({ stubOut: 'ALL' });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '', 'an empty spec list is how the step chooses the full run');
});

test('a failing scope-specs.sh falls back to the FULL suite', () => {
  const { label, specs } = prepare({ stubOut: '', stubCode: 1 });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '');
});

test('E2E_SCOPE=all ignores the scoped list', () => {
  const { label, specs } = prepare({
    scope: 'all',
    stubOut: 'scripts/smoke/games.smoke.spec.ts',
  });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '');
});

test('E2E_SCOPE=none does not scope either — the step skips instead', () => {
  const { label, specs } = prepare({
    scope: 'none',
    stubOut: 'scripts/smoke/games.smoke.spec.ts',
  });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '');
});

// The cases above stub scope-specs.sh. These two drive the REAL script through
// its SCOPE_FILES dry-run hook, because the bug they pin lived there, not in
// validate-ci.sh (Codex P2).
const SCOPE_SPECS = join(dirname(fileURLToPath(import.meta.url)), 'smoke', 'scope-specs.sh');
const REPO_ROOT = dirname(dirname(SCOPE_SPECS));

/** Real scope-specs.sh output for a synthetic changed-file list. */
function scopeSpecs(files) {
  return execFileSync('bash', [SCOPE_SPECS], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, SCOPE_FILES: files.join(' '), SCOPE_BASE: 'origin/main' },
  })
    .trim()
    .split('\n')
    .filter(Boolean);
}

test('scope-specs.sh: a diff of ONLY smoke specs stays scoped to those specs', () => {
  // Before ROK-1565's Codex fix the loop echoed the spec and `continue`d without
  // recording it, so `tokens` was empty and the script appended ALL — escalating
  // the one diff shape scoping serves best to a full-suite run.
  const out = scopeSpecs(['scripts/smoke/lfg-group-page.smoke.spec.ts']);

  assert.deepEqual(out, ['scripts/smoke/lfg-group-page.smoke.spec.ts']);
  assert.ok(!out.includes('ALL'), 'a spec-only diff must not escalate');
});

test('scope-specs.sh: a spec PLUS an unmappable web file still escalates', () => {
  // web/src/pages/index.tsx tokenises to nothing but generic words, so the
  // script cannot say which specs cover it -> ALL, which validate-ci.sh reads
  // (grep -qx) as "run everything".
  const out = scopeSpecs([
    'scripts/smoke/lfg-group-page.smoke.spec.ts',
    'web/src/pages/index.tsx',
  ]);

  assert.ok(out.includes('ALL'), `expected an ALL escalation, got ${JSON.stringify(out)}`);
});

test('a MIXED list (specs AND a trailing ALL) escalates to the full suite', () => {
  // scope-specs.sh prints a changed smoke spec, then ALL for a web file whose
  // tokens are all generic. Equality against 'ALL' missed that and produced
  // `npx playwright test <spec> ALL`, which NARROWS the run — the one direction
  // a gate may never fail in (review MAJOR 3).
  const { label, specs } = prepare({
    stubOut: 'scripts/smoke/games.smoke.spec.ts\nALL',
  });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '', 'a trailing ALL must win over the mapped specs');
});

test('a missing scope-specs.sh falls back to the FULL suite', () => {
  const { label, specs } = prepare({ noScript: true });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.equal(specs, '');
});

test('--no-e2e skips the scope resolution entirely', () => {
  const { specs } = prepare({
    e2eMode: 'off',
    stubOut: 'scripts/smoke/games.smoke.spec.ts',
  });

  assert.equal(specs, '');
});

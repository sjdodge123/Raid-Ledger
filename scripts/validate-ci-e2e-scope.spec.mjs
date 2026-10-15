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

// ---------------------------------------------------------------------------
// ROK-1792 — E2E_SPECS, an explicit spec list. The fleet gate rule is
// "--static + only the branch's new/changed specs", which E2E_SCOPE (an enum)
// cannot express. Pinned: parsing + validation (a bad path is exit 2, never a
// silent different selection), the explicit list winning over scope-specs.sh,
// the sentinel-compatible row label, and the exact `npx playwright test` argv
// (spec paths only — never a --project narrowing).
// ---------------------------------------------------------------------------
// The repo root (validate-ci.sh's own REPO_ROOT). The const above named
// REPO_ROOT is scripts/, the cwd scope-specs.sh needs.
const CHECKOUT = dirname(dirname(SCRIPT));
const REAL_SPECS = ['scripts/smoke/activity-timeline.smoke.spec.ts', 'scripts/smoke/add-character-dirty-close.smoke.spec.ts'];

/** Run _parse_e2e_specs against the real checkout. Returns { code, list, stderr }. */
function parseSpecs(value) {
  const script = [
    'set -uo pipefail',
    `REPO_ROOT=${JSON.stringify(CHECKOUT)}`,
    'RED=""; NC=""',
    `export E2E_SPECS=${JSON.stringify(value)}`,
    'E2E_SPECS_LIST=""',
    extractFunction('_parse_e2e_specs'),
    '_parse_e2e_specs; rc=$?',
    'echo "LIST=$E2E_SPECS_LIST"',
    'exit $rc',
  ].join('\n');
  const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
  return { code: res.status, list: (/^LIST=(.*)$/m.exec(res.stdout)?.[1] ?? '').trim(), stderr: res.stderr };
}

test('E2E_SPECS: space- and comma-separated lists parse, de-duplicated, in order', () => {
  const [a, b] = REAL_SPECS;
  assert.deepEqual(parseSpecs(`${a} ${b}`), { code: 0, list: `${a} ${b}`, stderr: '' });
  assert.equal(parseSpecs(`${a},${b}`).list, `${a} ${b}`);
  assert.equal(parseSpecs(` ${b}, ${a} ,${b} `).list, `${b} ${a}`);
});

test('E2E_SPECS: empty or unset leaves the list empty (scope-specs.sh decides)', () => {
  assert.deepEqual(parseSpecs(''), { code: 0, list: '', stderr: '' });
});

test('E2E_SPECS: every invalid path is rejected with exit 2 and named', () => {
  for (const bad of [
    'web/src/App.tsx',
    'scripts/smoke/../../api/x.spec.ts',
    'scripts/smoke/helpers.ts',
    '/abs/scripts/smoke/x.spec.ts',
    'scripts/smoke/x.spec.ts;rm',
  ]) {
    const res = parseSpecs(bad);
    assert.equal(res.code, 2, `${bad} must be an invocation error, got ${res.code}`);
    assert.equal(res.list, '', `${bad} must not leave a partial list`);
    assert.match(res.stderr, /not a scripts\/smoke\/<name>\.smoke\.spec\.ts path/);
  }
});

test('E2E_SPECS: a glob is rejected as written, never expanded to real files (Codex P2)', () => {
  // Unquoted word splitting would expand these to existing *.smoke.spec.ts
  // files, so the list would pass validation and run whatever matched.
  for (const glob of ['scripts/smoke/*.smoke.spec.ts', 'scripts/smoke/a?tivity-timeline.smoke.spec.ts', 'scripts/smoke/[a]ctivity-timeline.smoke.spec.ts']) {
    const res = parseSpecs(`${REAL_SPECS[0]} ${glob}`);
    assert.equal(res.code, 2, `${glob} must be an invocation error, got ${res.code} (list: ${res.list})`);
    assert.equal(res.list, '', `${glob} must not expand into a list`);
    assert.match(res.stderr, /contains a glob character/);
  }
});

test('E2E_SPECS: a scripts/smoke Vitest file Playwright never selects is rejected (Codex P2)', () => {
  // playwright.config.ts testMatch is /\.smoke\.spec\.ts$/: this file exists,
  // but a list naming it would pass while Playwright silently skipped it.
  const res = parseSpecs(`${REAL_SPECS[0]} scripts/smoke/console-filter.spec.ts`);
  assert.equal(res.code, 2);
  assert.equal(res.list, '');
  assert.match(res.stderr, /'scripts\/smoke\/console-filter\.spec\.ts' is not a scripts\/smoke\/<name>\.smoke\.spec\.ts path/);
});

test('E2E_SPECS: a well-formed but missing spec is exit 2, even beside a good one', () => {
  const res = parseSpecs(`${REAL_SPECS[0]} scripts/smoke/does-not-exist.smoke.spec.ts`);
  assert.equal(res.code, 2);
  assert.equal(res.list, '');
  assert.match(res.stderr, /does-not-exist\.smoke\.spec\.ts' does not exist/);
});

/** _prepare_playwright_scope with a pre-validated explicit list. */
function prepareExplicit(list, { stubOut = 'ALL', scope } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-specs-'));
  try {
    mkdirSync(join(root, 'scripts', 'smoke'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'smoke', 'scope-specs.sh'), `#!/usr/bin/env bash\necho ${stubOut}\n`);
    const script = [
      'set -uo pipefail',
      `REPO_ROOT=${JSON.stringify(root)}`,
      'YELLOW=""; NC=""; e2e_mode=auto',
      scope === undefined ? 'unset E2E_SCOPE || true' : `export E2E_SCOPE=${JSON.stringify(scope)}`,
      `E2E_SPECS_LIST=${JSON.stringify(list)}`,
      'PLAYWRIGHT_STEP_LABEL=""; PLAYWRIGHT_SCOPED_SPECS=""; E2E_SCOPE_RESOLVED=""',
      extractFunction('_resolve_e2e_scope'),
      extractFunction('_scoped_playwright_specs'),
      extractFunction('_prepare_playwright_scope'),
      '_prepare_playwright_scope >/dev/null 2>&1',
      'echo "LABEL=$PLAYWRIGHT_STEP_LABEL"',
      'echo "SPECS=$PLAYWRIGHT_SCOPED_SPECS"',
    ].join('\n');
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    return { label: /^LABEL=(.*)$/m.exec(out)?.[1] ?? '', specs: /^SPECS=(.*)$/m.exec(out)?.[1] ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('E2E_SPECS wins over an ALL from scope-specs.sh and labels the row for the sentinel', () => {
  const { label, specs } = prepareExplicit(REAL_SPECS.join(' '));
  assert.equal(label, 'Playwright (desktop + mobile, explicit: 2 specs)');
  // Mirrors tools/mcp-rl-fleet/src/gate-summary.ts PLAYWRIGHT_ROW — a PASS on
  // this row is what writes the playwright-tier pre-push sentinel.
  assert.match(label, /^Playwright \(desktop \+ mobile[^)]*\)$/);
  assert.equal(specs, REAL_SPECS.join(' '));
});

/** The argv run_playwright_e2e hands to `npx`, with the env up or down. */
function playwrightCommand(list, { envUp = true, relevant = false } = {}) {
  const script = [
    'set -uo pipefail',
    'YELLOW=""; RED=""; NC=""; e2e_mode=auto; e2e_explicit=false',
    `playwright_relevant=${relevant}`,
    `E2E_SPECS_LIST=${JSON.stringify(list)}`,
    `PLAYWRIGHT_SCOPED_SPECS=${JSON.stringify(list)}`,
    'E2E_SCOPE_RESOLVED=auto',
    `check_env_up() { return ${envUp ? 0 : 1}; }`,
    '_resolve_health_url() { echo http://stub/health; }',
    '_export_e2e_target() { :; }',
    'skip_step() { echo SKIPPED; }',
    'npx() { echo "NPX $*"; }',
    extractFunction('_resolve_e2e_scope'),
    extractFunction('run_playwright_e2e'),
    'run_playwright_e2e; echo "RC=$?"',
  ].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
}

test('E2E_SPECS runs exactly those specs on every project, even with no web diff', () => {
  const out = playwrightCommand(REAL_SPECS.join(' '));
  assert.match(out, new RegExp(`^NPX playwright test ${REAL_SPECS.join(' ')}$`, 'm'));
  assert.doesNotMatch(out, /--project/, 'the tier must never narrow projects');
  assert.doesNotMatch(out, /SKIPPED/, 'an explicit list bypasses the changed-files gate');
  assert.match(out, /^RC=0$/m);
});

test('E2E_SPECS against a down env FAILs instead of skipping', () => {
  const out = playwrightCommand(REAL_SPECS[0], { envUp: false });
  assert.doesNotMatch(out, /NPX|SKIPPED/);
  assert.match(out, /^RC=1$/m);
});

test('validate-ci.sh exits 2 before any step on a bad list or a conflicting mode', () => {
  const run = (env, args) =>
    spawnSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd: CHECKOUT,
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
  const good = REAL_SPECS.join(',');
  const cases = [
    [{ E2E_SPECS: 'scripts/smoke/nope.smoke.spec.ts' }, ['--only-e2e'], /does not exist/],
    [{ E2E_SPECS: good }, ['--static'], /E2E_SPECS and --static are mutually exclusive/],
    [{ E2E_SPECS: good }, ['--no-e2e'], /E2E_SPECS and --no-e2e are mutually exclusive/],
    [{ E2E_SPECS: good, E2E_SCOPE: 'none' }, ['--only-e2e'], /E2E_SPECS and E2E_SCOPE=none/],
    // Codex P2: every other mode that never reaches run_playwright_e2e.
    [{ E2E_SPECS: good }, ['--only-unit'], /E2E_SPECS and --only-unit are mutually exclusive/],
    [{ E2E_SPECS: good }, ['--only-integration'], /E2E_SPECS and --only-integration are mutually exclusive/],
    [{ E2E_SPECS: good }, ['--only-e2e', '--contrast-audit'], /E2E_SPECS and --contrast-audit are mutually exclusive/],
  ];
  for (const [env, args, msg] of cases) {
    const res = run(env, args);
    assert.equal(res.status, 2, `${JSON.stringify(env)} ${args} → ${res.status}: ${res.stderr.slice(-300)}`);
    assert.match(res.stderr, msg);
  }
});

// ---------------------------------------------------------------------------
// ROK-1792 — scope-specs.sh prints NONE when the diff maps to zero smoke specs
// (only a /dev/** wireframe route, or a new ui file nothing imports yet). The
// tier must SKIP — never run `npx playwright test NONE`, which fails — unless
// an explicit E2E_SPECS list or E2E_SCOPE=all says otherwise. A SKIPPED row is
// what keeps the playwright-tier sentinel unwritten (only a PASS writes it).
// ---------------------------------------------------------------------------

/** _prepare_playwright_scope THEN run_playwright_e2e, as main runs them. */
function prepareAndRun({ stubOut, scope, list = '', withE2e = false }) {
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-none-'));
  try {
    mkdirSync(join(root, 'scripts', 'smoke'), { recursive: true });
    const stub = join(root, 'scripts', 'smoke', 'scope-specs.sh');
    writeFileSync(stub, `#!/usr/bin/env bash\ncat <<'SPECS'\n${stubOut}\nSPECS\n`);
    chmodSync(stub, 0o755);
    const script = [
      'set -uo pipefail',
      `REPO_ROOT=${JSON.stringify(root)}`,
      withE2e ? 'YELLOW=""; RED=""; NC=""; e2e_mode=on; e2e_explicit=true' : 'YELLOW=""; RED=""; NC=""; e2e_mode=auto; e2e_explicit=false',
      'playwright_relevant=true',
      scope === undefined ? 'unset E2E_SCOPE || true' : `export E2E_SCOPE=${JSON.stringify(scope)}`,
      `E2E_SPECS_LIST=${JSON.stringify(list)}`,
      'PLAYWRIGHT_STEP_LABEL=""; PLAYWRIGHT_SCOPED_SPECS=""; PLAYWRIGHT_SCOPE_NONE=false; E2E_SCOPE_RESOLVED=""',
      'check_env_up() { return 0; }',
      '_resolve_health_url() { echo http://stub/health; }',
      '_export_e2e_target() { :; }',
      'skip_step() { echo SKIPPED; }',
      'npx() { echo "NPX $*"; }',
      extractFunction('_resolve_e2e_scope'),
      extractFunction('_scoped_playwright_specs'),
      extractFunction('_prepare_playwright_scope'),
      extractFunction('run_playwright_e2e'),
      '_prepare_playwright_scope >/dev/null 2>&1',
      'echo "LABEL=$PLAYWRIGHT_STEP_LABEL"',
      'run_playwright_e2e; echo "RC=$?"',
    ].join('\n');
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
    return { label: /^LABEL=(.*)$/m.exec(out)?.[1] ?? '', out };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('NONE from scope-specs.sh SKIPS the tier — no playwright invocation', () => {
  const { label, out } = prepareAndRun({ stubOut: 'NONE' });

  assert.equal(label, 'Playwright (desktop + mobile, no specs in scope)');
  // Mirrors tools/mcp-rl-fleet/src/gate-summary.ts PLAYWRIGHT_ROW: the parser
  // must still find the row, so its SKIPPED status is what it reads.
  assert.match(label, /^Playwright \(desktop \+ mobile[^)]*\)$/);
  assert.match(out, /^SKIPPED$/m);
  assert.doesNotMatch(out, /NPX/, `NONE must never reach npx; got ${out}`);
  assert.match(out, /maps this diff to no smoke spec/);
  assert.match(out, /^RC=0$/m);
});

test('NONE + E2E_SCOPE=all runs the FULL suite', () => {
  const { label, out } = prepareAndRun({ stubOut: 'NONE', scope: 'all' });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.match(out, /^NPX playwright test$/m);
  assert.doesNotMatch(out, /SKIPPED/);
});

test('NONE + E2E_SPECS runs exactly the explicit list', () => {
  const list = REAL_SPECS.join(' ');
  const { label, out } = prepareAndRun({ stubOut: 'NONE', list });

  assert.equal(label, 'Playwright (desktop + mobile, explicit: 2 specs)');
  assert.match(out, new RegExp(`^NPX playwright test ${list}$`, 'm'));
  assert.doesNotMatch(out, /SKIPPED|NONE/);
});

test('specs + ALL is unchanged by the NONE handling — full suite', () => {
  const { label, out } = prepareAndRun({ stubOut: 'scripts/smoke/games.smoke.spec.ts\nALL' });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.match(out, /^NPX playwright test$/m);
});

test('NONE + an explicit --with-e2e runs the FULL suite, never skips (Codex P2)', () => {
  const { label, out } = prepareAndRun({ stubOut: 'NONE', withE2e: true });

  assert.equal(label, 'Playwright (desktop + mobile)');
  assert.match(out, /^NPX playwright test$/m, `--with-e2e must force the suite; got ${out}`);
  assert.doesNotMatch(out, /SKIPPED/);
});

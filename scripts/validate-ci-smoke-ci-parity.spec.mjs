// node:test spec for validate-ci.sh's Discord smoke CI-parity helpers (ROK-1689).
//
// Why this exists: fleet gates showed 14–16 Discord smoke failures GitHub CI
// never saw, because `.github/workflows/discord-smoke.yml` runs the companion
// bot with concurrency 1, 2 retries, a 90s per-test timeout, a 15s Discord API
// timeout and voice-join skipped — and the fleet's `run_discord_smoke` set none
// of them (test-bot defaults: concurrency 5, 0 retries, 60s).
//
// The contract pinned here:
//   * the five values are READ from the workflow file, not hardcoded,
//   * a value the caller already exported wins (operator override),
//   * a missing key / unreadable workflow warns in yellow and never aborts,
//   * the parity applies on the fleet runner signal only — a laptop run keeps
//     the test-bot defaults (and its real voice-join coverage).
//
// Functions are extracted from the script rather than sourced: validate-ci.sh
// executes its main flow on source (same technique as
// validate-ci-discord-env.spec.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'validate-ci.sh');
const REAL_WORKFLOW = join(HERE, '..', '.github', 'workflows', 'discord-smoke.yml');
const ENV_SPIN = join(HERE, '..', 'rl-infra', 'orchestrator', 'bin', 'env-spin');
const KEYS = [
  'SMOKE_CONCURRENCY',
  'SMOKE_RETRY_COUNT',
  'SMOKE_TIMEOUT_MS',
  'DISCORD_API_TIMEOUT_MS',
  'SMOKE_SKIP_VOICE_JOIN',
];

function extractFunction(name) {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated ${name} in validate-ci.sh`);
  return src.slice(start, end + 3);
}

/** The key list constant, lifted out of the script so the test tracks it. */
function extractKeysLine() {
  const line = readFileSync(SCRIPT, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('CI_SMOKE_ENV_KEYS='));
  assert.ok(line, 'CI_SMOKE_ENV_KEYS not found in validate-ci.sh');
  return line;
}

const FIXTURE = `jobs:
  discord-smoke:
    env:
      API_URL: http://localhost:3000
      # Discord API timeout — relaxed for CI runners (ROK-969)
      DISCORD_API_TIMEOUT_MS: '11111'
      SMOKE_SKIP_VOICE_JOIN: '1'
      SMOKE_TIMEOUT_MS: "77777"
      SMOKE_CONCURRENCY: '3'   # trailing comment
      SMOKE_RETRY_COUNT: 4
    steps:
      - name: Run embed smoke tests
        env:
          SMOKE_CATEGORY: embed
`;

/**
 * Run `_apply_ci_smoke_parity` (the run_discord_smoke entry point) against a
 * workflow file. `workflow` is the file text, or null for "no file there".
 */
function runParity({ workflow, preset = {}, rlTarget = 'remote' }) {
  // Extract OUTSIDE the try: a missing helper must fail the test with its own
  // "<name> not found in validate-ci.sh" message, not a bare exit code.
  const helpers = [
    extractKeysLine(),
    extractFunction('_ci_workflow_env_value'),
    extractFunction('_print_ci_smoke_env'),
    extractFunction('_export_ci_smoke_env'),
    extractFunction('_apply_ci_smoke_parity'),
  ];
  const root = mkdtempSync(join(tmpdir(), 'validate-ci-smoke-parity-'));
  try {
    const wf = join(root, 'discord-smoke.yml');
    if (workflow !== null) writeFileSync(wf, workflow);
    const script = [
      'exec 2>&1', // warnings go to stderr; fold them into the captured output
      'set -euo pipefail',
      'RED=""; YELLOW=""; NC=""',
      ...KEYS.map((k) => `unset ${k} || true`),
      ...Object.entries(preset).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`),
      `export RL_TARGET=${JSON.stringify(rlTarget)}`,
      `CI_SMOKE_WORKFLOW=${JSON.stringify(wf)}`,
      ...helpers,
      '_apply_ci_smoke_parity',
      ...KEYS.map((k) => `echo "GOT ${k}=\${${k}:-<unset>}"`),
    ].join('\n');
    const out = execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function got(out, key) {
  const m = out.match(new RegExp(`GOT ${key}=(.*)`));
  return m ? m[1] : undefined;
}

test('fleet run: all five values are parsed from the workflow, quoting and comments stripped', () => {
  const r = runParity({ workflow: FIXTURE });
  assert.equal(r.code, 0, r.out);
  assert.equal(got(r.out, 'SMOKE_CONCURRENCY'), '3');
  assert.equal(got(r.out, 'SMOKE_RETRY_COUNT'), '4');
  assert.equal(got(r.out, 'SMOKE_TIMEOUT_MS'), '77777');
  assert.equal(got(r.out, 'DISCORD_API_TIMEOUT_MS'), '11111');
  assert.equal(got(r.out, 'SMOKE_SKIP_VOICE_JOIN'), '1');
  assert.match(
    r.out,
    /Discord smoke CI parity: concurrency=3 retries=4 timeout=77777ms api_timeout=11111ms\(env container, via env-spin\) skip_voice_join=1 \(from .*discord-smoke\.yml\)/,
  );
});

test('the real discord-smoke.yml still carries all five keys', () => {
  const r = runParity({ workflow: readFileSync(REAL_WORKFLOW, 'utf8') });
  assert.equal(r.code, 0, r.out);
  for (const k of KEYS) assert.notEqual(got(r.out, k), '<unset>', `${k} missing from discord-smoke.yml`);
  assert.doesNotMatch(r.out, /not found or unparseable in/);
});

test('a value the caller already exported wins over the workflow', () => {
  const r = runParity({ workflow: FIXTURE, preset: { SMOKE_CONCURRENCY: '7' } });
  assert.equal(r.code, 0, r.out);
  assert.equal(got(r.out, 'SMOKE_CONCURRENCY'), '7', 'operator override must not be clobbered');
  assert.equal(got(r.out, 'SMOKE_RETRY_COUNT'), '4');
  assert.match(r.out, /concurrency=7 /);
});

test('a key missing from the workflow warns (naming it) and does not abort', () => {
  const wf = FIXTURE.replace(/^\s+SMOKE_RETRY_COUNT:.*\n/m, '');
  const r = runParity({ workflow: wf });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /SMOKE_RETRY_COUNT not found or unparseable in .*discord-smoke\.yml/);
  assert.equal(got(r.out, 'SMOKE_RETRY_COUNT'), '<unset>');
  assert.equal(got(r.out, 'SMOKE_CONCURRENCY'), '3', 'the other keys still apply');
});

test('an unreadable workflow warns and does not abort', () => {
  const r = runParity({ workflow: null });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cannot read .*discord-smoke\.yml/);
  for (const k of KEYS) assert.equal(got(r.out, k), '<unset>');
});

test(
  'laptop run (not on the fleet runner): nothing is exported',
  { skip: existsSync('/workspace') ? 'running inside a fleet runner (/workspace exists)' : false },
  () => {
    const r = runParity({ workflow: FIXTURE, rlTarget: 'local' });
    assert.equal(r.code, 0, r.out);
    for (const k of KEYS) assert.equal(got(r.out, k), '<unset>', `${k} leaked into a laptop run`);
    assert.doesNotMatch(r.out, /Discord smoke CI parity:/);
  },
);

test('run_discord_smoke calls _apply_ci_smoke_parity (the helpers are wired in)', () => {
  const body = extractFunction('run_discord_smoke');
  const code = body
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  assert.match(code, /^\s*_apply_ci_smoke_parity\s*$/m, 'run_discord_smoke never calls _apply_ci_smoke_parity');
});

test("env-spin gives the env's API container discord-smoke.yml's DISCORD_API_TIMEOUT_MS", () => {
  // DISCORD_API_TIMEOUT_MS is read by the API, not the companion bot, so the
  // runner-shell export can't reach it — env-spin must set it on the env
  // container, and to the SAME value CI uses.
  const wfValue = execFileSync(
    'bash',
    ['-c', `${extractFunction('_ci_workflow_env_value')}\n_ci_workflow_env_value "$1" DISCORD_API_TIMEOUT_MS`, '_', REAL_WORKFLOW],
    { encoding: 'utf8' },
  ).trim();
  assert.match(wfValue, /^\d+$/, `discord-smoke.yml DISCORD_API_TIMEOUT_MS unparseable: "${wfValue}"`);
  const m = readFileSync(ENV_SPIN, 'utf8').match(/^\s*-e\s+DISCORD_API_TIMEOUT_MS=(\S+)\s*\\\s*$/m);
  assert.ok(m, 'env-spin does not pass -e DISCORD_API_TIMEOUT_MS=<n> to the env container');
  assert.equal(m[1], wfValue, 'env-spin DISCORD_API_TIMEOUT_MS drifted from discord-smoke.yml');
});

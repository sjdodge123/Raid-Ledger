// node:test spec for the ROK-2206 integration worker switch.
//
// RL_INTEGRATION_WORKERS (default 1) runs each api integration shard with N
// jest workers, each on its own DB cloned from a migrated `<base>_tpl`. The
// operator ruling is "flag off = byte-for-byte today's behaviour", which is
// silent to break, so this pins:
//   * api/package.json `test:integration` and the ci.yml flag-off command are
//     the pre-flag strings, unchanged (AC 1b),
//   * the jest config sets maxWorkers 1 and NO workerIdleMemoryLimit when the
//     flag is unset / 1 / invalid, and the knobs when it is on (AC 1, 5),
//   * validate-ci.sh drops --runInBand + uses the worker heap only when the
//     flag is on, and refuses INTEGRATION_PARALLEL alongside it (AC 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const OLD_SCRIPT =
  'NODE_OPTIONS="--max-old-space-size=4096" jest --config ./jest.integration.config.js --runInBand';
const OLD_CI_LINE =
  'npm run test:integration -w api -- --shard=${{ matrix.shard }} --randomize';

test('package.json: test:integration unchanged; workers script has no --runInBand', () => {
  const { scripts } = JSON.parse(read('api/package.json'));
  assert.equal(scripts['test:integration'], OLD_SCRIPT);
  assert.equal(
    scripts['test:integration:workers'],
    'NODE_OPTIONS="--max-old-space-size=${RL_INTEGRATION_HEAP_MB:-2048}" jest --config ./jest.integration.config.js',
  );
});

test('ci.yml: flag-off branch runs the pre-flag command; flag defaults to 1', () => {
  const ci = read('.github/workflows/ci.yml');
  const step = ci.slice(ci.indexOf('- name: Run integration tests (shard'));
  const elseAt = step.indexOf('else\n');
  assert.notEqual(elseAt, -1, 'integration step has no else branch');
  const elseLine = step.slice(elseAt + 5).split('\n')[0].trim();
  assert.equal(elseLine, OLD_CI_LINE);
  assert.match(step, /if \[ "\$\{RL_INTEGRATION_WORKERS:-1\}" -gt 1 \] 2>\/dev\/null; then/);
  assert.ok(
    ci.includes(
      "RL_INTEGRATION_WORKERS: ${{ inputs.integration_workers || vars.RL_INTEGRATION_WORKERS || '1' }}",
    ),
    'shard env must default RL_INTEGRATION_WORKERS to 1',
  );
  assert.match(ci, /workflow_dispatch:\n {4}inputs:\n {6}integration_workers:/);
});

/** The integration jest config as loaded under `env`. */
function loadConfig(env) {
  const r = spawnSync(
    process.execPath,
    ['-e', 'const c=require("./api/jest.integration.config.js");process.stdout.write(JSON.stringify({m:c.maxWorkers,has:"workerIdleMemoryLimit" in c,idle:c.workerIdleMemoryLimit}))'],
    { cwd: ROOT, env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

for (const value of [undefined, '1', '0', 'abc', '2.5', '']) {
  test(`jest config: RL_INTEGRATION_WORKERS=${JSON.stringify(value)} is flag off`, () => {
    const env = value === undefined ? {} : { RL_INTEGRATION_WORKERS: value };
    assert.deepEqual(loadConfig(env), { m: 1, has: false });
  });
}

test('jest config: flag on sets maxWorkers and the idle-memory knob', () => {
  assert.deepEqual(loadConfig({ RL_INTEGRATION_WORKERS: '2' }), { m: 2, has: true, idle: '1536MB' });
  assert.deepEqual(
    loadConfig({ RL_INTEGRATION_WORKERS: '3', RL_INTEGRATION_IDLE_MEMORY: '1MB' }),
    { m: 3, has: true, idle: '1MB' },
  );
});

/** A validate-ci.sh function body, lifted out verbatim (sourcing runs main). */
function extractFunction(name) {
  const src = read('scripts/validate-ci.sh');
  const start = src.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `${name} not found in validate-ci.sh`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return src.slice(start, end + 3);
}

/** Run `body` with the three functions defined and `npx` stubbed to echo. */
function runBash(body, env) {
  const dir = mkdtempSync(join(tmpdir(), 'integration-workers-'));
  try {
    mkdirSync(join(dir, 'api'));
    const script = [
      'set -euo pipefail',
      'npx() { echo "NODE_OPTIONS=$NODE_OPTIONS ARGS=$*"; }',
      extractFunction('_integration_workers_on'),
      extractFunction('_integration_parallelism'),
      extractFunction('_integration_shard_jest'),
      body,
    ].join('\n');
    return spawnSync('bash', ['-c', script], {
      cwd: dir,
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('validate-ci: flag off keeps --runInBand and the caller heap', () => {
  for (const env of [{}, { RL_INTEGRATION_WORKERS: '1' }, { RL_INTEGRATION_WORKERS: 'x' }]) {
    const r = runBash('_integration_shard_jest 1 4 4096 ""', env);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /NODE_OPTIONS=--max-old-space-size=4096 ARGS=.* --runInBand --verbose/);
  }
});

test('validate-ci: flag on drops --runInBand and uses the worker heap', () => {
  const r = runBash('_integration_shard_jest 2 4 4096 ""', { RL_INTEGRATION_WORKERS: '2' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /--runInBand/);
  assert.match(r.stdout, /NODE_OPTIONS=--max-old-space-size=2048 ARGS=.*--shard=2\/4/);
  const custom = runBash('_integration_shard_jest 1 4 4096 ""', {
    RL_INTEGRATION_WORKERS: '2',
    RL_INTEGRATION_HEAP_MB: '3072',
  });
  assert.match(custom.stdout, /max-old-space-size=3072/);
});

test('validate-ci: INTEGRATION_PARALLEL=2 with the flag on runs shards serially', () => {
  const on = runBash('_integration_parallelism 4', { INTEGRATION_PARALLEL: '2', RL_INTEGRATION_WORKERS: '2' });
  assert.equal(on.stdout.trim(), '1');
  assert.match(on.stderr, /RL_INTEGRATION_WORKERS=2 already runs workers in parallel/);
  const off = runBash('_integration_parallelism 4', { INTEGRATION_PARALLEL: '2' });
  assert.equal(off.stdout.trim(), '2');
});

test('validate-ci: --integration-workers=N sets RL_INTEGRATION_WORKERS without exporting it', () => {
  const src = read('scripts/validate-ci.sh');
  assert.ok(
    src.includes('--integration-workers=*) RL_INTEGRATION_WORKERS="${1#--integration-workers=}"; shift ;;'),
  );
  assert.doesNotMatch(src, /export RL_INTEGRATION_WORKERS/);
  // An inherited value is un-exported after arg parsing too.
  assert.ok(src.includes('export -n RL_INTEGRATION_WORKERS'));
});

test('validate-ci: a non-exported flag reaches only the integration jest env (Codex P2)', () => {
  // Stub npx/jest report what their child env really carries (printenv), the
  // way a unit `npx jest` run would see it.
  const body = [
    'RL_INTEGRATION_WORKERS=2',
    'npx() { echo "INTEG=$(printenv RL_INTEGRATION_WORKERS || echo unset)"; }',
    '_integration_shard_jest 1 4 4096 ""',
    'echo "UNIT=$(printenv RL_INTEGRATION_WORKERS || echo unset)"',
  ].join('\n');
  const r = runBash(body, {});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /INTEG=2/);
  assert.match(r.stdout, /UNIT=unset/);
});

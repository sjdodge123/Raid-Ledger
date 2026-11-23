// End-to-end: lane-check.sh in a throwaway git repo. The diff removes a user
// string from api source while a test-bot smoke spec still pins it, so the
// smoke-string row must FAIL. LANE_CHECK_ONLY=smoke keeps tsc/jest out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ['lane-check.sh', 'lane-check-plan.mjs', 'scoped-gate-plan.mjs'];

// Hermetic env for every child: the caller's PATH may hold stub binaries
// (validate-ci-fleet-scope-skip.test.sh runs this spec with a fake `git` whose
// `diff --name-only` prints the harness's own change set), and those would
// leak into the fixture repo. Use the system tool dirs plus this node's dir,
// and drop the harness's STUB_* variables.
const CLEAN_PATH = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
const BASE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('STUB_')));
BASE_ENV.PATH = CLEAN_PATH;

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// opts.prefix: temp dir name; opts.base / opts.lane: extra {path: text} files
// in the base commit / the lane commit.
function fixtureRepo(smokeText, opts = {}) {
  const root = mkdtempSync(join(tmpdir(), opts.prefix ?? 'lane-check-e2e-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe', env: BASE_ENV });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.invalid');
  git('config', 'user.name', 'e2e');
  mkdirSync(join(root, 'scripts'));
  SCRIPTS.forEach((f) => copyFileSync(join(HERE, f), join(root, 'scripts', f)));
  write(root, 'api/src/x/reply.ts', "export const r = () => 'Signups are closed now';\n");
  write(root, 'tools/test-bot/src/smoke/tests/x.test.ts', smokeText);
  Object.entries(opts.base ?? {}).forEach(([rel, text]) => write(root, rel, text));
  git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'lane');
  write(root, 'api/src/x/reply.ts', "export const r = () => 'Sign-ups closed';\n");
  Object.entries(opts.lane ?? {}).forEach(([rel, text]) => write(root, rel, text));
  git('add', '-A'); git('commit', '-qm', 'change copy');
  return root;
}

function run(root, extraEnv = {}, args = []) {
  return spawnSync('bash', ['scripts/lane-check.sh', ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...BASE_ENV, LANE_CHECK_BASE: 'main', LANE_CHECK_ONLY: 'smoke',
      // never contend with a real lane-check running on this laptop
      LANE_CHECK_LOCK_DIR: join(root, '.lane-check-test.lock'), ...extraEnv },
  });
}

test('a smoke spec pinning removed text fails the smoke-string row', () => {
  const root = fixtureRepo("expect(msg).toContain('Signups are closed now');\n");
  try {
    const res = run(root);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /smoke-string\s+\| Signups are closed now\s+\| FAIL/);
    assert.match(res.stdout, /x\.test\.ts:1:/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the same diff passes when no smoke spec pins the old text', () => {
  const root = fixtureRepo("expect(msg).toContain('Sign-ups closed');\n");
  try {
    const res = run(root);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /smoke-string\s+\| Signups are closed now\s+\| PASS/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Machine-wide lock. Each case gets its own lock dir; the "live holder" is this
// test process (its pid is alive for the whole test).
const PASSING_SMOKE = "expect(msg).toContain('Sign-ups closed');\n";

function heldLock(pid) {
  const dir = join(mkdtempSync(join(tmpdir(), 'lane-check-lock-')), 'lock');
  mkdirSync(dir);
  writeFileSync(join(dir, 'pid'), `${pid}\n`);
  return dir;
}

function deadPid() {
  const res = spawnSync('true');
  return res.pid;
}

test('a second run waits for a live holder, then proceeds once it releases', async () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const lock = heldLock(process.pid);
  try {
    const child = spawn('bash', ['scripts/lane-check.sh'], {
      cwd: root,
      env: { ...BASE_ENV, LANE_CHECK_BASE: 'main', LANE_CHECK_ONLY: 'smoke',
        LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_POLL: '1', LANE_CHECK_LOCK_WAIT: '30' },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`never waited:\n${out}`)), 15000);
      const tick = setInterval(() => {
        if (out.includes(`waiting for lane-check pid ${process.pid}`)) {
          clearInterval(tick); clearTimeout(deadline); resolve();
        }
      }, 50);
    });
    assert.ok(existsSync(lock), 'the waiting run must not have touched the held lock');
    rmSync(lock, { recursive: true, force: true }); // the first run releases
    const code = await exited;
    assert.equal(code, 0, out);
    assert.equal(out.split('waiting for lane-check pid').length - 1, 1, `exactly one waiting line:\n${out}`);
    assert.match(out, /RESULT: PASS/);
    assert.equal(existsSync(lock), false, 'the run must release its own lock on exit');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dirname(lock), { recursive: true, force: true }); }
});

test('a lock whose pid is dead is stale and taken over', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const pid = deadPid();
  const lock = heldLock(pid);
  try {
    const res = run(root, { LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_WAIT: '5', LANE_CHECK_LOCK_POLL: '1' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, new RegExp(`taking over a stale lock from dead pid ${pid}`));
    assert.doesNotMatch(res.stdout, /waiting for lane-check/);
    assert.equal(existsSync(lock), false, 'the taken-over lock is released on exit');
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dirname(lock), { recursive: true, force: true }); }
});

test('a live holder past LANE_CHECK_LOCK_WAIT exits 75 and leaves its lock alone', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const lock = heldLock(process.pid);
  try {
    const res = run(root, { LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_WAIT: '1', LANE_CHECK_LOCK_POLL: '1' });
    assert.equal(res.status, 75, res.stdout + res.stderr);
    assert.match(res.stderr, new RegExp(`gave up after 1s .*pid ${process.pid} still holds`));
    assert.doesNotMatch(res.stdout, /RESULT:/, 'no step may run without the lock');
    assert.equal(readFileSync(join(lock, 'pid'), 'utf8').trim(), String(process.pid));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dirname(lock), { recursive: true, force: true }); }
});

test('--plan ignores a held lock', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const lock = heldLock(process.pid);
  try {
    const res = run(root, { LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_WAIT: '0' }, ['--plan']);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.doesNotMatch(res.stdout + res.stderr, /waiting for lane-check|gave up/);
    assert.equal(readFileSync(join(lock, 'pid'), 'utf8').trim(), String(process.pid));
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(dirname(lock), { recursive: true, force: true }); }
});

// ROK-2310 review fixes. A fake npx/npm on PATH records each call and behaves
// like jest/vitest on a folder with no test files: exit 1 unless
// --passWithNoTests, which prints the "exiting with code 0" line.
function fakeBin(root) {
  const bin = join(root, '.fake-bin');
  const body = `#!/bin/sh
echo "$(basename "$0") $*" >>"${join(root, '.fake.log')}"
case "$*" in *passWithNoTests*) echo "No test files found, exiting with code 0"; exit 0 ;; esac
case "$*" in *vitest*|*jest*) echo "No test files found"; exit 1 ;; esac
exit 0
`;
  ['npx', 'npm'].forEach((n) => { write(root, `.fake-bin/${n}`, body); chmodSync(join(bin, n), 0o755); });
  return { PATH: `${bin}:${CLEAN_PATH}` };
}
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test('a web folder with no test files is SKIPPED (no tests), not a FAIL', () => {
  const root = fixtureRepo(PASSING_SMOKE, { lane: { 'web/src/plugins/discord/register.ts': 'export const x = 1;\n' } });
  try {
    const res = run(root, { ...fakeBin(root), LANE_CHECK_ONLY: 'tests' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /vitest\s+\| web\/src\/plugins\/discord\s+\| SKIPPED \| \d+ {2}\(no tests\)/);
    assert.match(res.stdout, /jest\s+\| api\/src\/x\s+\| SKIPPED \| \d+ {2}\(no tests\)/);
  } finally { cleanup(root); }
});

test('a contract change builds the contract before the api/web typechecks', () => {
  const root = fixtureRepo(PASSING_SMOKE, { lane: { 'packages/contract/src/x.ts': 'export const x = 1;\n' } });
  try {
    const res = run(root, { ...fakeBin(root), LANE_CHECK_ONLY: 'typecheck' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /contract-build\s+\| packages\/contract\s+\| PASS/);
    const calls = readFileSync(join(root, '.fake.log'), 'utf8').trim().split('\n');
    assert.equal(calls[0], 'npm run build -w packages/contract', calls.join('\n'));
    assert.ok(calls.slice(1).some((c) => c.includes('-p api/tsconfig.json')), calls.join('\n'));
  } finally { cleanup(root); }
});

test('a repo path with a space still plans and fails the pinned smoke string', () => {
  const root = fixtureRepo("expect(msg).toContain('Signups are closed now');\n", { prefix: 'lane check e2e ' });
  try {
    const res = run(root);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /smoke-string\s+\| Signups are closed now\s+\| FAIL/);
  } finally { cleanup(root); }
});

test('a planner that prints nothing is a loud FAIL, never an empty PASS', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  try {
    writeFileSync(join(root, 'scripts/lane-check-plan.mjs'), '// broken: prints nothing\n');
    const res = run(root);
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /printed no plan/);
    assert.doesNotMatch(res.stdout, /RESULT: PASS/);
  } finally { cleanup(root); }
});

test('a removed string still rendered by other source is SKIPPED, not a FAIL', () => {
  const root = fixtureRepo("expect(msg).toContain('Signups are closed now');\n",
    { base: { 'web/src/y/banner.tsx': "export const b = 'Signups are closed now';\n" } });
  try {
    const res = run(root);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /smoke-string\s+\| Signups are closed now\s+\| SKIPPED \| \d+ {2}\(still in source\)/);
  } finally { cleanup(root); }
});

test('a lock dir with no pid file, older than the grace period, is taken over', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const lock = join(mkdtempSync(join(tmpdir(), 'lane-check-lock-')), 'lock');
  mkdirSync(lock);
  const old = new Date(Date.now() - 120_000);
  utimesSync(lock, old, old);
  try {
    const res = run(root, { LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_WAIT: '2', LANE_CHECK_LOCK_POLL: '1' });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /taking over a stale lock from a run that died before writing its pid/);
    assert.equal(existsSync(lock), false, 'the taken-over lock is released on exit');
  } finally { cleanup(root); rmSync(dirname(lock), { recursive: true, force: true }); }
});

test('a fresh pid-less lock (a run between mkdir and its pid write) is waited on', () => {
  const root = fixtureRepo(PASSING_SMOKE);
  const lock = join(mkdtempSync(join(tmpdir(), 'lane-check-lock-')), 'lock');
  mkdirSync(lock);
  try {
    const res = run(root, { LANE_CHECK_LOCK_DIR: lock, LANE_CHECK_LOCK_WAIT: '1', LANE_CHECK_LOCK_POLL: '1', LANE_CHECK_LOCK_GRACE: '600' });
    assert.equal(res.status, 75, res.stdout + res.stderr);
    assert.ok(existsSync(lock), 'a fresh pid-less lock must not be taken over');
  } finally { cleanup(root); rmSync(dirname(lock), { recursive: true, force: true }); }
});

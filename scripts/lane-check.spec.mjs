// End-to-end: lane-check.sh in a throwaway git repo. The diff removes a user
// string from api source while a test-bot smoke spec still pins it, so the
// smoke-string row must FAIL. LANE_CHECK_ONLY=smoke keeps tsc/jest out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = ['lane-check.sh', 'lane-check-plan.mjs', 'scoped-gate-plan.mjs'];

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function fixtureRepo(smokeText) {
  const root = mkdtempSync(join(tmpdir(), 'lane-check-e2e-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.invalid');
  git('config', 'user.name', 'e2e');
  mkdirSync(join(root, 'scripts'));
  SCRIPTS.forEach((f) => copyFileSync(join(HERE, f), join(root, 'scripts', f)));
  write(root, 'api/src/x/reply.ts', "export const r = () => 'Signups are closed now';\n");
  write(root, 'tools/test-bot/src/smoke/tests/x.test.ts', smokeText);
  git('add', '-A'); git('commit', '-qm', 'base');
  git('checkout', '-qb', 'lane');
  write(root, 'api/src/x/reply.ts', "export const r = () => 'Sign-ups closed';\n");
  git('commit', '-qam', 'change copy');
  return root;
}

function run(root, extraEnv = {}, args = []) {
  return spawnSync('bash', ['scripts/lane-check.sh', ...args], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, LANE_CHECK_BASE: 'main', LANE_CHECK_ONLY: 'smoke',
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
      env: { ...process.env, LANE_CHECK_BASE: 'main', LANE_CHECK_ONLY: 'smoke',
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

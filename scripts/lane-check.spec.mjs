// End-to-end: lane-check.sh in a throwaway git repo. The diff removes a user
// string from api source while a test-bot smoke spec still pins it, so the
// smoke-string row must FAIL. LANE_CHECK_ONLY=smoke keeps tsc/jest out of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

function run(root) {
  return spawnSync('bash', ['scripts/lane-check.sh'], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, LANE_CHECK_BASE: 'main', LANE_CHECK_ONLY: 'smoke' },
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

/**
 * ROK-1566 — unit spec for `scripts/smoke/push-gate.sh` (the pre-push hook's
 * body). node:test, throwaway git repos, an injected sentinel dir: nothing
 * here reads the real /tmp or the real repo.
 *
 *   node --test scripts/push-gate.spec.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SMOKE = join(dirname(fileURLToPath(import.meta.url)), 'smoke');
const GATE = join(SMOKE, 'push-gate.sh');
const SURFACE = join(SMOKE, 'surface-hash.sh');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function makeRepo(webChange = true) {
  const dir = mkdtempSync(join(tmpdir(), 'push-gate-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  writeFileSync(join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const rel = webChange ? 'web/src/app.tsx' : 'api/src/thing.ts';
  mkdirSync(join(dir, dirname(rel)), { recursive: true });
  writeFileSync(join(dir, rel), 'export const A = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'change');
  return dir;
}

const run = (dir, sentinelDir) =>
  JSON.parse(
    execFileSync('bash', [GATE], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, RL_PLAYWRIGHT_SENTINEL_DIR: sentinelDir },
    }),
  );

const shortSha = (dir) => git(dir, 'rev-parse', '--short', 'HEAD');

const surfaceHash = (dir) =>
  execFileSync('bash', [SURFACE], { cwd: dir, encoding: 'utf8' }).trim();

const denied = (verdict) =>
  verdict.hookSpecificOutput?.permissionDecision === 'deny';

function withRepo(webChange, fn) {
  const dir = makeRepo(webChange);
  const sentinels = mkdtempSync(join(tmpdir(), 'push-gate-sentinels-'));
  try {
    fn(dir, sentinels);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(sentinels, { recursive: true, force: true });
  }
}

test('allows when a fresh sentinel names this web surface', () => {
  withRepo(true, (dir, sentinels) => {
    writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), '{}\n');
    const verdict = run(dir, sentinels);
    assert.equal(verdict.continue, true);
    assert.equal(verdict.matched, 'surface');
  });
});

// One-cycle fallback (paired with the writer's dual write): a PASS earned under
// the old sha-keyed hook, or by /push's local `touch`, still counts.
test('allows on a fresh LEGACY sha-named sentinel, reporting matched=sha', () => {
  withRepo(true, (dir, sentinels) => {
    writeFileSync(join(sentinels, `.playwright-verified-${shortSha(dir)}`), '');
    const verdict = run(dir, sentinels);
    assert.equal(verdict.continue, true);
    assert.equal(verdict.matched, 'sha');
  });
});

test('denies on a STALE legacy sha-named sentinel', () => {
  withRepo(true, (dir, sentinels) => {
    const path = join(sentinels, `.playwright-verified-${shortSha(dir)}`);
    writeFileSync(path, '');
    execFileSync('touch', ['-t', '202001010000', path]);
    assert.ok(denied(run(dir, sentinels)));
  });
});

test('denies when no sentinel exists, naming the surface hash', () => {
  withRepo(true, (dir, sentinels) => {
    const verdict = run(dir, sentinels);
    assert.ok(denied(verdict));
    assert.match(
      verdict.hookSpecificOutput.permissionDecisionReason,
      new RegExp(surfaceHash(dir)),
    );
  });
});

test('denies on a sentinel older than the 24h age guard', () => {
  withRepo(true, (dir, sentinels) => {
    const path = join(sentinels, `.playwright-verified-${surfaceHash(dir)}`);
    writeFileSync(path, '{}\n');
    execFileSync('touch', ['-t', '202001010000', path]);
    assert.ok(denied(run(dir, sentinels)));
  });
});

test('allows outright when the branch touches no web surface', () => {
  withRepo(false, (dir, sentinels) => {
    assert.equal(surfaceHash(dir), 'nosurface');
    assert.equal(run(dir, sentinels).matched, 'nosurface');
  });
});

// The four ways the gate used to fail OPEN. Every one of them must DENY: a
// surface that cannot be computed is not evidence that nothing changed.
test('denies when git is not on PATH', () => {
  withRepo(true, (dir, sentinels) => {
    const bin = mkdtempSync(join(tmpdir(), 'push-gate-bin-'));
    for (const tool of ['sed', 'find', 'cut', 'dirname']) {
      try {
        symlinkSync(execFileSync('which', [tool], { encoding: 'utf8' }).trim(), join(bin, tool));
      } catch {
        /* tool is a shell builtin here */
      }
    }
    const verdict = JSON.parse(
      execFileSync('/bin/bash', [GATE], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: bin, RL_PLAYWRIGHT_SENTINEL_DIR: sentinels },
      }),
    );
    assert.ok(denied(verdict));
    rmSync(bin, { recursive: true, force: true });
  });
});

test('denies when origin/main does not resolve', () => {
  withRepo(true, (dir, sentinels) => {
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.ok(denied(run(dir, sentinels)));
  });
});

test('ignores a stray SURFACE_BASE in the hook environment', () => {
  withRepo(true, (dir, sentinels) => {
    // SURFACE_BASE=HEAD would make every branch look like `nosurface`.
    const verdict = JSON.parse(
      execFileSync('bash', [GATE], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          SURFACE_BASE: 'HEAD',
          RL_PLAYWRIGHT_SENTINEL_DIR: sentinels,
        },
      }),
    );
    assert.ok(denied(verdict));
  });
});

test('still denies when surface-hash.sh has lost its exec bit', () => {
  withRepo(true, (dir, sentinels) => {
    const bin = mkdtempSync(join(tmpdir(), 'push-gate-scripts-'));
    for (const f of ['push-gate.sh', 'surface-hash.sh']) {
      writeFileSync(join(bin, f), readFileSync(join(SMOKE, f)));
    }
    chmodSync(join(bin, 'surface-hash.sh'), 0o644);
    const verdict = JSON.parse(
      execFileSync('bash', [join(bin, 'push-gate.sh')], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, RL_PLAYWRIGHT_SENTINEL_DIR: sentinels },
      }),
    );
    assert.ok(denied(verdict));
    assert.match(verdict.hookSpecificOutput.permissionDecisionReason, /surface/);
    rmSync(bin, { recursive: true, force: true });
  });
});

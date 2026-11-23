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

// ROK-2205: the body the MCP server writes on a gate_verified run.
const VERIFIED_BODY = '{"gate_verified":true,"sha":"8fd1f515","tier":"static"}\n';

test('allows when a fresh gate_verified sentinel names this web surface', () => {
  withRepo(true, (dir, sentinels) => {
    writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), VERIFIED_BODY);
    const verdict = run(dir, sentinels);
    assert.equal(verdict.continue, true);
    assert.equal(verdict.matched, 'surface');
  });
});

// TDB:1416 retired the one-cycle sha-keyed fallback (and the MCP writer's dual
// write): a FRESH sha-named sentinel must no longer satisfy the gate.
test('denies on a fresh sha-named sentinel — the legacy sha key is retired', () => {
  withRepo(true, (dir, sentinels) => {
    writeFileSync(join(sentinels, `.playwright-verified-${shortSha(dir)}`), '');
    const verdict = run(dir, sentinels);
    assert.ok(denied(verdict), 'a sha-named sentinel must not unlock the push');
    // Denied for the RIGHT reason: the surface lookup ran and found no file —
    // not the unresolvable-surface deny, which would also pass the line above.
    assert.match(
      verdict.hookSpecificOutput.permissionDecisionReason,
      /not verified for web surface/,
    );
  });
});

// ROK-2205: a sentinel written before gate_verified was recorded (an empty
// body, `{}`, or an explicit false) fails closed and names the fix.
for (const [label, body] of [
  ['an empty (legacy) body', ''],
  ['a body without gate_verified', '{"sha":"8fd1f515","tier":"static"}\n'],
  ['gate_verified: false', '{"gate_verified":false,"tier":"static"}\n'],
]) {
  test(`denies a fresh sentinel with ${label}, naming the fix`, () => {
    withRepo(true, (dir, sentinels) => {
      writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), body);
      const verdict = run(dir, sentinels);
      assert.ok(denied(verdict), `a sentinel with ${label} must not unlock the push`);
      const reason = verdict.hookSpecificOutput.permissionDecisionReason;
      assert.match(reason, /gate_verified: true/);
      assert.match(reason, /log_tail_bytes:3000/);
    });
  });
}

// ROK-2205 review M2: a body an OLDER MCP server wrote (it has task_id but no
// gate_verified key) is rewritten the same way by that server on every re-run,
// so the deny must name the real fix — update the checkout and restart the
// session — or agents loop on fleet gates.
test('denies a sentinel from a pre-ROK-2205 MCP server, naming the restart fix', () => {
  withRepo(true, (dir, sentinels) => {
    const oldBody = '{"sha":"8fd1f515","surface":"x","tier":"static","task_id":"ab12cd34ef56"}\n';
    writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), oldBody);
    const verdict = run(dir, sentinels);
    assert.ok(denied(verdict), 'an old-server sentinel must not unlock the push');
    const reason = verdict.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, /ROK-2205/);
    assert.match(reason, /restart the Claude session/);
    assert.match(reason, /pull main/);
  });
});

// Review m4: only a TOP-LEVEL leading `"gate_verified": true` counts.
for (const [label, body] of [
  ['a nested true behind a top-level false', '{"gate_verified":false,"prev":{"gate_verified":true}}\n'],
  ['a true that is not a JSON true', '{"gate_verified":trueX}\n'],
]) {
  test(`denies a fresh sentinel with ${label}`, () => {
    withRepo(true, (dir, sentinels) => {
      writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), body);
      assert.ok(denied(run(dir, sentinels)), `a sentinel with ${label} must not unlock the push`);
    });
  });
}

// Review n2: a hand-written /push body with spaces is still a verified body.
test('allows a gate_verified body written with spaces', () => {
  withRepo(true, (dir, sentinels) => {
    const body = '{ "gate_verified" : true, "tier": "local-playwright" }\n';
    writeFileSync(join(sentinels, `.playwright-verified-${surfaceHash(dir)}`), body);
    assert.equal(run(dir, sentinels).matched, 'surface');
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
    writeFileSync(path, VERIFIED_BODY);
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

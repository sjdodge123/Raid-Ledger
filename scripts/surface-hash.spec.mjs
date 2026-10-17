/**
 * ROK-1566 — unit spec for `scripts/smoke/surface-hash.sh`.
 *
 * node:test rather than Jest: the subject is a shell script outside `api/src`.
 * Each case builds a throwaway git repo with an `origin/main` ref, so nothing
 * here touches the real repo or /tmp sentinels.
 *
 *   node --test scripts/surface-hash.spec.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'smoke', 'surface-hash.sh');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A temp repo whose `origin/main` ref points at an initial commit. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'surface-hash-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  commit(dir, 'README.md', 'base\n', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return dir;
}

function commit(dir, relPath, contents, message) {
  const full = join(dir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

const hashIn = (dir) =>
  execFileSync('bash', [SCRIPT], { cwd: dir, encoding: 'utf8' }).trim();

test('is stable across a docs-only follow-up commit', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'web/src/app.tsx', 'export const A = 1;\n', 'feat: web');
    const before = hashIn(dir);
    commit(dir, 'docs/notes.md', 'notes\n', 'docs: notes');
    assert.notEqual(before, 'nosurface');
    assert.equal(hashIn(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('changes on a one-byte web/ edit', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'web/src/app.tsx', 'export const A = 1;\n', 'feat: web');
    const before = hashIn(dir);
    commit(dir, 'web/src/app.tsx', 'export const A = 2;\n', 'feat: tweak');
    assert.notEqual(hashIn(dir), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('prints nosurface when nothing on the web surface changed', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'api/src/thing.ts', 'export const B = 1;\n', 'feat: api');
    assert.equal(hashIn(dir), 'nosurface');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('honours SURFACE_BASE', () => {
  const dir = makeRepo();
  try {
    commit(dir, 'web/src/app.tsx', 'export const A = 1;\n', 'feat: web');
    const fromHead = execFileSync('bash', [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, SURFACE_BASE: 'HEAD' },
    }).trim();
    assert.equal(fromHead, 'nosurface');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Review MAJOR 2: without `--binary` the patch body for an image swap is only
// "Binary files ... differ", so two DIFFERENT pngs hashed identically and a
// fixture/image change kept a stale sentinel green.
test('distinguishes two different binary bodies at the same path', () => {
  const dir = makeRepo();
  try {
    const png = join(dir, 'web', 'public', 'a.png');
    mkdirSync(dirname(png), { recursive: true });
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'png v1');
    const first = hashIn(dir);

    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xfe, 0xdc, 0xba]));
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'png v2');

    assert.notEqual(first, 'nosurface');
    assert.notEqual(hashIn(dir), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Review MAJOR 3: validate-ci.sh triggers Playwright on these too, so an auth
// or demo-test follow-up must NOT keep a sentinel green.
test('covers api/src/auth and api/src/admin/demo-test*', () => {
  for (const rel of ['api/src/auth/jwt.guard.ts', 'api/src/admin/demo-test-core.controller.ts']) {
    const dir = makeRepo();
    try {
      commit(dir, 'web/src/app.tsx', 'export const A = 1;\n', 'feat: web');
      const before = hashIn(dir);
      commit(dir, rel, 'export const G = 1;\n', `feat: ${rel}`);
      assert.notEqual(hashIn(dir), before, `${rel} must change the surface hash`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// A surface that cannot be computed must never read as `nosurface` — the gate
// fails closed on a non-zero exit.
test('exits non-zero (not `nosurface`) when the base does not resolve', () => {
  const dir = makeRepo();
  try {
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    assert.throws(
      () => execFileSync('bash', [SCRIPT], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }),
      (err) => err.status === 3,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

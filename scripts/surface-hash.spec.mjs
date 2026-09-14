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

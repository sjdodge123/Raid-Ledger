// node:test spec for how `validate-ci.sh --scoped` collects the branch's
// changed files (2026-10-22 review M1/M2/m8). The selector spec pins the
// path -> tier mapping; this one pins the git side that feeds it, in a
// throwaway repo, by sourcing validate-ci.sh with RL_VALIDATE_CI_DRY=1 (which
// skips main() and every install) and calling its functions directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_ROOT = dirname(HERE);
const SCRIPT = join(HERE, 'validate-ci.sh');
// The validate-ci scope-skip harness runs this spec with a stub `git` first on
// PATH that fakes `diff --name-only` / `ls-files --others`; it exports the real
// binary as REAL_GIT. This spec needs real git answers from its temp repo.
const GIT = process.env.REAL_GIT ?? 'git';

/** Run git in `cwd`; throws with git's stderr on failure. */
function git(cwd, ...args) {
  const r = spawnSync(GIT, ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** Write a file (creating its directories) inside the temp repo. */
function put(root, path, body = 'x\n') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}

/** A temp repo with one commit; `withBase` points origin/main at it. */
function makeRepo(t, { withBase }) {
  const root = mkdtempSync(join(tmpdir(), 'scoped-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q', '-b', 'main');
  put(root, 'packages/contract/src/x.ts');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'base');
  if (withBase) git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}

/** Source validate-ci.sh in `cwd` and run `snippet`; REPO_ROOT → the real
 *  checkout so run_scoped_gate finds the real selector. A `git` shell function
 *  (functions beat PATH) pins the script's git calls to the real binary. */
function inScript(cwd, snippet) {
  const body = `SPEC_REAL_GIT="$3"; git() { command "$SPEC_REAL_GIT" "$@"; }; source "$1"; REPO_ROOT="$2"; ${snippet}`;
  return spawnSync('bash', ['-c', body, 'spec', SCRIPT, REAL_ROOT, GIT], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, RL_VALIDATE_CI_DRY: '1', RL_TARGET: 'local' },
  });
}

test('a rename out of packages/contract lists the contract path, so --scoped still refuses', (t) => {
  const root = makeRepo(t, { withBase: true });
  mkdirSync(join(root, 'api/src'), { recursive: true });
  git(root, 'mv', 'packages/contract/src/x.ts', 'api/src/x.ts');
  git(root, 'commit', '-q', '-m', 'move');

  const listed = inScript(root, '_scoped_changed_files');
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split('\n').filter(Boolean);
  assert.ok(
    files.includes('packages/contract/src/x.ts'),
    `expected the rename source packages/contract/src/x.ts in the changed files, got: ${JSON.stringify(files)}`,
  );
  assert.ok(files.includes('api/src/x.ts'), `expected the rename target api/src/x.ts, got: ${JSON.stringify(files)}`);

  const gate = inScript(root, 'run_scoped_gate');
  assert.equal(gate.status, 2, `expected exit 2 (refused), got ${gate.status}: ${gate.stderr}`);
  assert.match(gate.stderr, /packages\/contract\/src\/x\.ts touches packages\/contract/);
});

test('an unresolvable origin/main refuses with exit 2 instead of planning from uncommitted files', (t) => {
  const root = makeRepo(t, { withBase: false });
  put(root, 'scripts/smoke/wip.smoke.spec.ts');

  const gate = inScript(root, 'run_scoped_gate');
  assert.equal(gate.status, 2, `expected exit 2 (fail closed), got ${gate.status}: ${gate.stdout}${gate.stderr}`);
  assert.match(gate.stderr, /origin\/main does not resolve/);
});

test('a mode-only change in the worktree (Mutagen 100755 -> 0644) is not a changed file (ROK-2182)', (t) => {
  const root = makeRepo(t, { withBase: true });
  put(root, 'docker/allinone/entrypoint.sh', '#!/bin/sh\n');
  git(root, 'add', '.');
  git(root, 'update-index', '--chmod=+x', 'docker/allinone/entrypoint.sh');
  git(root, 'commit', '-q', '-m', 'exec script');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  // The runner's sync lands the file at 0644 while git tracks 100755.
  spawnSync('chmod', ['0644', join(root, 'docker/allinone/entrypoint.sh')]);
  git(root, 'config', 'core.fileMode', 'true');
  assert.match(git(root, 'diff', '--summary', 'HEAD'), /mode change 100755 => 100644/, 'fixture must show a mode-only diff');
  put(root, 'web/src/a.ts');

  const listed = inScript(root, '_scoped_changed_files');
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split('\n').filter(Boolean);
  assert.deepEqual(files, ['web/src/a.ts'], `expected only the real change, got: ${JSON.stringify(files)}`);
});

test('a stale local origin/main is refreshed before the diff, so main-only commits are not listed (ROK-2182)', (t) => {
  const root = makeRepo(t, { withBase: true });
  const remote = mkdtempSync(join(tmpdir(), 'scoped-gate-remote-'));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  git(remote, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', remote);
  // main moves on (a docker change lands) and the branch is cut from it,
  // but this checkout's origin/main still points at the old base.
  put(root, 'docker/allinone/entrypoint.sh', '#!/bin/sh\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'main moves');
  git(root, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD~1');
  put(root, 'web/src/a.ts');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'branch work');

  const listed = inScript(root, '_scoped_refresh_base; _scoped_changed_files');
  assert.equal(listed.status, 0, listed.stderr);
  const files = listed.stdout.split('\n').filter(Boolean);
  assert.deepEqual(files, ['web/src/a.ts'], `expected only the branch's change, got: ${JSON.stringify(files)}`);
});

test('refreshing the base tolerates a missing/unreachable origin (ROK-2182)', (t) => {
  const root = makeRepo(t, { withBase: true });
  git(root, 'remote', 'add', 'origin', join(root, 'does-not-exist'));
  const r = inScript(root, '_scoped_refresh_base; echo ok');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ok');
});

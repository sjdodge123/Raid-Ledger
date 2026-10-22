/**
 * node:test spec for scripts/renumber-branch-migrations.sh and the migration
 * index-collision guard. A temp git repo reproduces the real collision: main
 * and a branch both added migration 0002 (journal idx, .sql and snapshot) on
 * top of the same parent, so whichever merges second has to renumber.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIndexCollisions, formatCollisionReport } from './check-migration-index-collision.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(SCRIPTS, 'renumber-branch-migrations.sh');
const GUARD = path.join(SCRIPTS, 'check-migration-index-collision.mjs');
const CHAIN = path.join(SCRIPTS, 'check-migration-snapshot-chain.mjs');
const MIG = 'api/src/drizzle/migrations';
const ROOT_ID = '00000000-0000-0000-0000-000000000000';
const T0 = 1790000000000;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const read = (dir, rel) => readFileSync(path.join(dir, MIG, rel), 'utf8');
const journal = (dir) => JSON.parse(read(dir, 'meta/_journal.json')).entries;

// drizzle-kit writes snapshots with 2-space JSON and no trailing newline.
const snapshot = (id, prevId, table) =>
  JSON.stringify({ id, prevId, version: '7', dialect: 'postgresql', tables: { [table]: {} } }, null, 2);
const entry = (idx, name, when) => ({ idx, version: '7', when, tag: `${String(idx).padStart(4, '0')}_${name}`, breakpoints: true });

function writeMig(dir, files, entries) {
  for (const [rel, body] of Object.entries(files)) writeFileSync(path.join(dir, MIG, rel), body);
  const j = { version: '7', dialect: 'postgresql', entries };
  writeFileSync(path.join(dir, MIG, 'meta/_journal.json'), JSON.stringify(j, null, 2) + '\n');
}

function commitAll(dir, msg) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

/** main: 0000,0001 → +0002_main_x. feature (from 0001): +0002_branch_feat (snapshot) +0003_branch_custom (no snapshot). */
function buildFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rl-renumber-'));
  mkdirSync(path.join(dir, MIG, 'meta'), { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'fixture@example.com');
  git(dir, 'config', 'user.name', 'fixture');
  const common = [entry(0, 'init', T0), entry(1, 'a', T0 + 1000)];
  writeMig(dir, {
    '0000_init.sql': 'CREATE TABLE "t0" ();\n',
    '0001_a.sql': 'CREATE TABLE "t1" ();\n',
    'meta/0000_snapshot.json': snapshot('id-0000', ROOT_ID, 't0'),
    'meta/0001_snapshot.json': snapshot('id-0001', 'id-0000', 't1'),
  }, common);
  commitAll(dir, 'common');
  git(dir, 'checkout', '-q', '-b', 'feature');
  writeMig(dir, {
    '0002_branch_feat.sql': 'CREATE TABLE "feat" ();\n--> statement-breakpoint\nALTER TABLE "feat" ADD COLUMN "x" int;\n',
    '0003_branch_custom.sql': '-- custom: hand-written\nUPDATE "feat" SET "x" = 1;\n',
    'meta/0002_snapshot.json': snapshot('id-feat', 'id-0001', 'feat'),
  }, [...common, entry(2, 'branch_feat', T0 + 2000), entry(3, 'branch_custom', T0 + 3000)]);
  commitAll(dir, 'feature migrations');
  git(dir, 'checkout', '-q', 'main');
  writeMig(dir, {
    '0002_main_x.sql': 'CREATE TABLE "main_x" ();\n',
    'meta/0002_snapshot.json': snapshot('id-main', 'id-0001', 'main_x'),
  }, [...common, entry(2, 'main_x', T0 + 5000)]);
  commitAll(dir, 'main migration');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
  git(dir, 'checkout', '-q', 'feature');
  return dir;
}

test('collision guard: the fixture branch collides with origin/main and the report names the fix command', (t) => {
  const dir = buildFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const res = run(dir, 'node', [GUARD, '--root', dir]);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /0002_branch_feat: idx 2 collides with origin\/main's 0002_main_x/);
  assert.match(res.stderr, /\.\/scripts\/renumber-branch-migrations\.sh/);
});

test('renumber: moves branch migrations after main, rewrites journal + snapshot chain, never touches SQL', (t) => {
  const dir = buildFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const featSql = read(dir, '0002_branch_feat.sql');
  const customSql = read(dir, '0003_branch_custom.sql');
  const featSnap = read(dir, 'meta/0002_snapshot.json');

  const res = run(dir, 'bash', [TOOL, '--no-fetch']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /0002_branch_feat → 0003_branch_feat/);
  assert.match(res.stdout, /validate-migrations\.sh/);

  assert.equal(read(dir, '0003_branch_feat.sql'), featSql);
  assert.equal(read(dir, '0004_branch_custom.sql'), customSql);
  assert.equal(existsSync(path.join(dir, MIG, '0002_branch_feat.sql')), false);
  assert.equal(read(dir, '0002_main_x.sql'), 'CREATE TABLE "main_x" ();\n');
  assert.equal(JSON.parse(read(dir, 'meta/0002_snapshot.json')).id, 'id-main');
  const moved = read(dir, 'meta/0003_snapshot.json');
  assert.equal(moved, featSnap.replace('"prevId": "id-0001"', '"prevId": "id-main"'));
  assert.equal(existsSync(path.join(dir, MIG, 'meta/0004_snapshot.json')), false);

  const entries = journal(dir);
  assert.deepEqual(entries.map((e) => [e.idx, e.tag]), [
    [0, '0000_init'], [1, '0001_a'], [2, '0002_main_x'], [3, '0003_branch_feat'], [4, '0004_branch_custom'],
  ]);
  for (let i = 1; i < entries.length; i++) {
    assert.ok(entries[i].when > entries[i - 1].when, `when not increasing at ${entries[i].tag}`);
  }
  assert.equal(entries[2].when, T0 + 5000, 'main entry when must be untouched');

  const chain = run(dir, 'node', [CHAIN, '--dir', path.join(dir, MIG, 'meta')]);
  assert.equal(chain.status, 0, chain.stdout + chain.stderr);
  const guard = run(dir, 'node', [GUARD, '--root', dir]);
  assert.equal(guard.status, 0, guard.stdout + guard.stderr);
});

test('renumber is idempotent and the result merges main without a migrations conflict', (t) => {
  const dir = buildFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, 'bash', [TOOL, '--no-fetch']).status, 0);
  commitAll(dir, 'renumber');
  const again = run(dir, 'bash', [TOOL, '--no-fetch']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /nothing to renumber/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const merge = run(dir, 'git', ['merge', '--no-edit', '-q', 'main']);
  assert.equal(merge.status, 0, merge.stdout + merge.stderr);
  assert.deepEqual(journal(dir).map((e) => e.tag).slice(2), ['0002_main_x', '0003_branch_feat', '0004_branch_custom']);
});

test('renumber refuses a dirty tree and changes nothing', (t) => {
  const dir = buildFixture();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'scratch.txt'), 'wip\n');
  const res = run(dir, 'bash', [TOOL, '--no-fetch']);
  assert.notEqual(res.status, 0);
  assert.match(res.stdout + res.stderr, /dirty/i);
  assert.equal(existsSync(path.join(dir, MIG, '0002_branch_feat.sql')), true);
  assert.equal(journal(dir).length, 4);
});

test('findIndexCollisions: duplicate idx and duplicate tag prefix inside one journal (a bad merge) are caught', () => {
  const base = [entry(0, 'init', T0), entry(1, 'a', T0 + 1)];
  const head = [...base, entry(2, 'main_x', T0 + 2), entry(2, 'branch_feat', T0 + 3)];
  const kinds = findIndexCollisions(base, head, []).map((v) => [v.kind, v.tag]);
  assert.deepEqual(kinds, [['duplicate-idx', '0002_branch_feat']]);
  const sameTag = [...base, { ...entry(2, 'x', T0 + 2) }, { ...entry(3, 'y', T0 + 3), tag: '0002_y' }];
  assert.deepEqual(findIndexCollisions(base, sameTag, []).map((v) => v.kind), ['tag-idx-mismatch', 'duplicate-prefix']);
});

test('findIndexCollisions: two .sql files sharing a prefix are caught; a clean tail passes', () => {
  const base = [entry(0, 'init', T0)];
  const head = [...base, entry(1, 'mine', T0 + 1)];
  assert.deepEqual(findIndexCollisions(base, head, ['0000_init.sql', '0001_mine.sql']), []);
  const v = findIndexCollisions(base, head, ['0000_init.sql', '0001_mine.sql', '0001_theirs.sql']);
  assert.deepEqual(v.map((x) => x.kind), ['duplicate-file-prefix']);
  assert.match(formatCollisionReport(v, 'origin/main'), /renumber-branch-migrations\.sh/);
});

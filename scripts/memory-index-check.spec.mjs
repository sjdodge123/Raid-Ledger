// node:test spec for scripts/memory-index-check.mjs (ROK-2308).
//
// Each case builds a throwaway memory dir in the OS temp dir (never under
// ~/.claude) and calls the exported pure check; two cases drive the CLI to pin
// the exit codes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMemoryIndex, slugFor } from './memory-index-check.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'memory-index-check.mjs');

/** Writes MEMORY.md (`index`) plus `files` ({ name: body }) into a temp dir, runs `fn(dir)`. */
function withDir(index, files, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'memory-index-'));
  try {
    if (index !== null) writeFileSync(join(dir, 'MEMORY.md'), index);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAN = '# Memory\n\n## Notes\n\n- [A](a.md) — one\n- [B](b.md) — two\n';
const AB = { 'a.md': 'a', 'b.md': 'b' };

test('a clean index passes with no warnings', () => {
  const r = withDir(CLEAN, AB, checkMemoryIndex);
  assert.deepEqual(r.fails, []);
  assert.deepEqual(r.warns, []);
  assert.equal(r.lines, 6);
});

test('more than 200 lines fails', () => {
  const filler = Array.from({ length: 200 }, (_, i) => `- note ${i}`).join('\n');
  const r = withDir(`${CLEAN}${filler}\n`, AB, checkMemoryIndex);
  assert.equal(r.fails.length, 1, r.fails.join('\n'));
  assert.match(r.fails[0], /^FAIL: MEMORY\.md has 206 lines/);
});

test('a doubled index fails on the repeated lines and the twice-indexed files', () => {
  const r = withDir(CLEAN + CLEAN, AB, checkMemoryIndex);
  assert.ok(r.fails.some((f) => /line 7 repeats line 1: # Memory/.test(f)), r.fails.join('\n'));
  assert.ok(r.fails.some((f) => /a\.md is indexed twice \(lines 5 and 11\)/.test(f)), r.fails.join('\n'));
});

test('two different lines linking the same file fail', () => {
  const r = withDir(`${CLEAN}- [A again](a.md) — dup\n`, AB, checkMemoryIndex);
  assert.deepEqual(r.fails, ['FAIL: a.md is indexed twice (lines 5 and 7)']);
});

test('a link to a missing file fails', () => {
  const r = withDir(CLEAN, { 'a.md': 'a' }, checkMemoryIndex);
  assert.deepEqual(r.fails, ['FAIL: line 6 links b.md, which does not exist']);
});

test('a memory file with no index line fails', () => {
  const r = withDir(CLEAN, { ...AB, 'c.md': 'c' }, checkMemoryIndex);
  assert.deepEqual(r.fails, ['FAIL: c.md has no index line in MEMORY.md']);
});

test('a long line and a heavy file warn without failing', () => {
  const long = `- [A](a.md) — ${'x'.repeat(30 * 1024)}`;
  const r = withDir(`# Memory\n${long}\n- [B](b.md)\n`, AB, checkMemoryIndex);
  assert.deepEqual(r.fails, []);
  assert.equal(r.warns.length, 2, r.warns.join('\n'));
  assert.match(r.warns[0], /^WARN: line 2 is \d+ chars \(> 200\)/);
  assert.match(r.warns[1], /^WARN: MEMORY\.md is \d+ bytes \(> 25600\)/);
});

test('a missing dir is not an error', () => {
  const r = checkMemoryIndex(join(tmpdir(), 'memory-index-does-not-exist-2308'));
  assert.equal(r.exists, false);
  const cli = spawnSync('node', [SCRIPT, '--dir', join(tmpdir(), 'memory-index-does-not-exist-2308')], {
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /^memory-index-check: no memory dir at /);
});

test('the CLI exits 1 on a FAIL and 0 with an OK line', () => {
  const bad = withDir(CLEAN, {}, (dir) => spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8' }));
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  const ok = withDir(CLEAN, AB, (dir) => spawnSync('node', [SCRIPT, '--dir', dir], { encoding: 'utf8' }));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /OK — .*MEMORY\.md, 6 lines, \d+ bytes/);
});

test('slugFor replaces every slash', () => {
  assert.equal(slugFor('/Users/x/Projects/Raid-Ledger'), '-Users-x-Projects-Raid-Ledger');
});

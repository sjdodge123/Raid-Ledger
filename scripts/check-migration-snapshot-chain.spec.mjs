/**
 * TDB:1150 — node:test spec for the migration snapshot prevId chain guard.
 * Synthetic chains reproduce the two real breaks (0102 pointed at 0101's TAG,
 * 0112 pointed at an id no snapshot has), and one test walks the real meta
 * directory so a future broken link fails this suite, not a later reader.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  META_REL,
  ROOT_PREV_ID,
  findChainViolations,
  formatReport,
  orderSnapshotFiles,
  readSnapshots,
} from './check-migration-snapshot-chain.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/check-migration-snapshot-chain.mjs');

const snap = (idx, id, prevId) => ({ file: `${String(idx).padStart(4, '0')}_snapshot.json`, id, prevId });
const GOOD = [snap(0, 'a', ROOT_PREV_ID), snap(101, 'b207', 'a'), snap(102, 'c', 'b207')];

test('the 0102 shape — prevId is the previous migration TAG, not its id — is a broken link', () => {
  const chain = [GOOD[0], GOOD[1], snap(102, '0102_lineup_phase_scheduling', '0101_regular_adam_destine')];
  assert.deepEqual(findChainViolations(chain), [
    {
      kind: 'broken-link',
      file: '0102_snapshot.json',
      prevId: '0101_regular_adam_destine',
      expected: 'b207',
      expectedFile: '0101_snapshot.json',
      pointsAt: null,
    },
  ]);
});

test('the 0112 shape — prevId matches no snapshot across a numbering gap — expects the previous EXISTING snapshot', () => {
  const chain = [...GOOD, snap(107, 'c2ae', 'c'), snap(112, 'd4f0', 'e860-orphan')];
  const [v] = findChainViolations(chain);
  assert.deepEqual([v.file, v.expected, v.expectedFile, v.pointsAt], ['0112_snapshot.json', 'c2ae', '0107_snapshot.json', null]);
  assert.match(formatReport([v]), /0112_snapshot\.json: prevId e860-orphan \(no snapshot\) should be c2ae \(0107_snapshot\.json's id\)/);
});

test('a prevId that skips a snapshot names the snapshot it actually points at', () => {
  const chain = [...GOOD, snap(103, 'd', 'b207')];
  assert.deepEqual(findChainViolations(chain).map((v) => [v.file, v.pointsAt, v.expectedFile]), [
    ['0103_snapshot.json', '0101_snapshot.json', '0102_snapshot.json'],
  ]);
});

test('numbering gaps are normal when every snapshot links to the one before it', () => {
  assert.deepEqual(findChainViolations([...GOOD, snap(107, 'g', 'c'), snap(112, 'h', 'g')]), []);
});

test('a copied snapshot that kept its id (0195 cloned from 0194) is a duplicate id', () => {
  const chain = [...GOOD, snap(194, 'x', 'c'), snap(195, 'x', 'x')];
  assert.deepEqual(findChainViolations(chain), [
    { kind: 'duplicate-id', file: '0195_snapshot.json', id: 'x', firstFile: '0194_snapshot.json' },
  ]);
});

test('a copied snapshot with a fresh id pointing at its source passes', () => {
  assert.deepEqual(findChainViolations([...GOOD, snap(194, 'x', 'c'), snap(195, 'y', 'x')]), []);
});

test('the first snapshot must descend from drizzle root id, and missing ids are malformed', () => {
  assert.deepEqual(findChainViolations([snap(0, 'a', 'z')]).map((v) => [v.kind, v.expected]), [
    ['broken-link', ROOT_PREV_ID],
  ]);
  assert.deepEqual(findChainViolations([GOOD[0], snap(1, '', 'a')]).map((v) => v.kind), ['malformed']);
});

test('orderSnapshotFiles sorts numerically and drops non-snapshot files', () => {
  const files = ['0112_snapshot.json', '_journal.json', '0009_snapshot.json', '10000_snapshot.json', '0102_snapshot.json'];
  assert.deepEqual(orderSnapshotFiles(files), ['0009_snapshot.json', '0102_snapshot.json', '0112_snapshot.json', '10000_snapshot.json']);
});

test('the real migrations meta directory has an intact chain (TDB:1150 regression)', () => {
  const snapshots = readSnapshots(path.join(REPO_ROOT, META_REL));
  assert.ok(snapshots.length > 150, `expected the real snapshot set, read ${snapshots.length}`);
  assert.deepEqual(findChainViolations(snapshots), []);
});

function runCli(files) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'snapshot-chain-'));
  try {
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, name), body);
    return spawnSync(process.execPath, [SCRIPT, '--dir', dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const json = (id, prevId) => JSON.stringify({ id, prevId, version: '7' });

test('CLI exits 0 on an intact chain, 1 on a broken link, 3 on malformed JSON', () => {
  const ok = runCli({ '0000_snapshot.json': json('a', ROOT_PREV_ID), '0002_snapshot.json': json('b', 'a') });
  assert.equal(ok.status, 0, ok.stderr);
  const broken = runCli({ '0000_snapshot.json': json('a', ROOT_PREV_ID), '0002_snapshot.json': json('b', '0000_init') });
  assert.equal(broken.status, 1, broken.stdout);
  assert.match(broken.stderr, /0002_snapshot\.json: prevId 0000_init \(no snapshot\) should be a/);
  const bad = runCli({ '0000_snapshot.json': '{ not json' });
  assert.equal(bad.status, 3, bad.stderr);
  assert.match(bad.stderr, /0000_snapshot\.json: not valid JSON/);
});

/**
 * Unit spec for the ROK-1160 D4 journal check (restore-drill-journal.mjs).
 * node:test for the same reason as restore-drill-assertions.spec.mjs: ESM
 * `.mjs` outside `api/src`. No database — `sql` is a stub.
 *
 *   node --test scripts/restore-drill-journal.spec.mjs
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { readJournal, runJournalCheck } from './restore-drill-journal.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const byId = (findings, id) => findings.find((f) => f.id === id);

const JOURNAL = [
  { tag: '0000_a', when: 1, hash: sha('CREATE TABLE a();') },
  { tag: '0001_b', when: 2, hash: sha('CREATE TABLE b();') },
];

/**
 * `sql` stub: table presence, every restored hash, newest restored hash.
 * `count(*)` is still answered so a regression to a row-count check fails on
 * its own assertion rather than an unstubbed-query throw.
 */
const sqlStub = ({ table = true, hashes = [], latest }) => async (text) => {
  if (text.includes('to_regclass')) {
    return [{ t: table ? 'drizzle.__drizzle_migrations' : null }];
  }
  if (text.includes('count(*)')) return [{ n: hashes.length }];
  if (text.includes('ORDER BY created_at DESC')) {
    return latest === undefined ? [] : [{ hash: latest }];
  }
  if (text.includes('SELECT hash FROM')) return hashes.map((hash) => ({ hash }));
  throw new Error(`unstubbed query: ${text}`);
};

const HASHES = JOURNAL.map((e) => e.hash);
const hashesFinding = (findings) => {
  const f = byId(findings, 'journal-hashes-present');
  assert.ok(f, `no journal-hashes-present in ${findings.map((x) => x.id)}`);
  return f;
};

test('readJournal hashes each <tag>.sql the way drizzle does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-journal-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const entries = [{ idx: 0, when: 7, tag: '0000_x', breakpoints: true }];
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', entries }),
  );
  fs.writeFileSync(path.join(dir, '0000_x.sql'), 'SELECT 1;\n');
  assert.deepEqual(readJournal(dir), [
    { tag: '0000_x', when: 7, hash: sha('SELECT 1;\n') },
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('passes when every journal hash is present and the latest matches', async () => {
  const sql = sqlStub({ hashes: HASHES, latest: JOURNAL[1].hash });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.deepEqual(
    findings.map((f) => [f.id, f.tier, f.status]),
    [
      ['journal-hashes-present', 'reconcile', 'passed'],
      ['journal-latest-hash', 'reconcile', 'passed'],
    ],
  );
});

test('fails hashes-present when the restore dropped the journal (pre-D4 dump)', async () => {
  const findings = await runJournalCheck({
    sql: sqlStub({ table: false }),
    journal: JOURNAL,
  });
  const f = hashesFinding(findings);
  assert.equal(f.status, 'failed');
  assert.match(f.detail, /no drizzle\.__drizzle_migrations/);
});

test('extra historical rows (e.g. an orphaned draft hash) pass with a note', async () => {
  const orphan = sha('draft migration tested before merge');
  const sql = sqlStub({ hashes: [HASHES[0], orphan, HASHES[1]], latest: HASHES[1] });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  const f = hashesFinding(findings);
  assert.equal(f.status, 'passed', f.detail);
  assert.match(f.detail, /1 extra restored row\(s\) not in the image journal/);
});

test('fails hashes-present when a journal hash is missing, naming the tag', async () => {
  const sql = sqlStub({ hashes: [HASHES[0], sha('foreign')], latest: HASHES[0] });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  const f = hashesFinding(findings);
  assert.equal(f.status, 'failed', f.detail);
  assert.match(f.detail, /missing 1 of 2 .*0001_b/);
});

test('fails the latest hash when the newest restored row is foreign', async () => {
  const sql = sqlStub({ hashes: HASHES, latest: sha('other branch') });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.equal(hashesFinding(findings).status, 'passed');
  const f = byId(findings, 'journal-latest-hash');
  assert.equal(f.status, 'failed');
  assert.match(f.detail, /!= 0001_b/);
});

test('fails the latest hash when the journal table is empty', async () => {
  const sql = sqlStub({ hashes: [] });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.equal(byId(findings, 'journal-latest-hash').status, 'failed');
  assert.match(byId(findings, 'journal-latest-hash').detail, /\(none\)/);
});

test('expects the entry with the max `when`, not the last array entry', async () => {
  const journal = [
    { tag: '0000_a', when: 1, hash: sha('a') },
    { tag: '0001_b', when: 30, hash: sha('b') },
    { tag: '0002_c', when: 20, hash: sha('c') },
  ];
  const sql = sqlStub({ hashes: journal.map((e) => e.hash), latest: sha('b') });
  const f = byId(await runJournalCheck({ sql, journal }), 'journal-latest-hash');
  assert.equal(f.status, 'passed', f.detail);
  assert.match(f.detail, /matches 0001_b/);
});

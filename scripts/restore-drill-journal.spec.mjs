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

/** `sql` stub: table presence, restored row count, newest restored hash. */
const sqlStub = ({ table = true, count, latest }) => async (text) => {
  if (text.includes('to_regclass')) {
    return [{ t: table ? 'drizzle.__drizzle_migrations' : null }];
  }
  if (text.includes('count(*)')) return [{ n: count }];
  if (text.includes('ORDER BY created_at DESC')) {
    return latest === undefined ? [] : [{ hash: latest }];
  }
  throw new Error(`unstubbed query: ${text}`);
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

test('passes when row count and latest hash match the image journal', async () => {
  const sql = sqlStub({ count: 2, latest: JOURNAL[1].hash });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.deepEqual(
    findings.map((f) => [f.id, f.tier, f.status]),
    [
      ['journal-row-count', 'reconcile', 'passed'],
      ['journal-latest-hash', 'reconcile', 'passed'],
    ],
  );
});

test('fails the row count when the restore dropped the journal (pre-D4 dump)', async () => {
  const findings = await runJournalCheck({
    sql: sqlStub({ table: false }),
    journal: JOURNAL,
  });
  const f = byId(findings, 'journal-row-count');
  assert.equal(f.status, 'failed');
  assert.match(f.detail, /no drizzle\.__drizzle_migrations/);
});

test('fails the row count when restored rows != image journal entries', async () => {
  const sql = sqlStub({ count: 1, latest: JOURNAL[0].hash });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  const f = byId(findings, 'journal-row-count');
  assert.equal(f.status, 'failed');
  assert.equal(f.detail, '1 restored journal rows, image journal has 2');
});

test('fails the latest hash when the newest restored row is foreign', async () => {
  const sql = sqlStub({ count: 2, latest: sha('other branch') });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.equal(byId(findings, 'journal-row-count').status, 'passed');
  const f = byId(findings, 'journal-latest-hash');
  assert.equal(f.status, 'failed');
  assert.match(f.detail, /!= 0001_b/);
});

test('fails the latest hash when the journal table is empty', async () => {
  const sql = sqlStub({ count: 0 });
  const findings = await runJournalCheck({ sql, journal: JOURNAL });
  assert.equal(byId(findings, 'journal-latest-hash').status, 'failed');
  assert.match(byId(findings, 'journal-latest-hash').detail, /\(none\)/);
});

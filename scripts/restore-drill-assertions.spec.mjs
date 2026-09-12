/**
 * Unit spec for the ROK-1160 drill assertions (T-U1 .. T-U7).
 *
 * node:test rather than Jest: the module under test is ESM `.mjs` outside
 * `api/src` (api's jest.config has `rootDir: 'src'`, `testRegex: .spec.ts`),
 * and ts-jest's CommonJS transform cannot import it. No database and no
 * binaries — every dependency is injected.
 *
 *   node --test scripts/restore-drill-assertions.spec.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertRails,
  bootHealthUrl,
  classifyRestoreStderr,
  runArchiveCheck,
  runReferentialCheck,
  runRowCountCheck,
  runSanitizationCheck,
  runSchemaShapeCheck,
  summarize,
} from './restore-drill-assertions.mjs';
import {
  CRITICAL_INDEXES,
  CRITICAL_TABLES,
  MIN_TOC_TABLE_ENTRIES,
} from './restore-drill.constants.mjs';

const byId = (findings, id) => findings.find((f) => f.id === id);

/** A `sql(text)` stub that dispatches on a substring of the query text. */
const sqlStub = (routes) => async (text) => {
  for (const [needle, rows] of routes) {
    if (text.includes(needle)) return rows;
  }
  throw new Error(`unstubbed query: ${text}`);
};

const tocStdout = (n) =>
  Array.from({ length: n }, (_, i) => `${i}; 0 0 TABLE DATA public t${i} user`)
    .join('\n');

test('T-U1 A1 passes at the TOC floor and fails below it, naming the count', async () => {
  const pass = await runArchiveCheck({
    dumpFile: '/tmp/x.dump',
    execFile: async () => ({ stdout: tocStdout(MIN_TOC_TABLE_ENTRIES), stderr: '' }),
  });
  assert.equal(pass[0].status, 'passed');

  const fail = await runArchiveCheck({
    dumpFile: '/tmp/x.dump',
    execFile: async () => ({ stdout: tocStdout(2), stderr: '' }),
  });
  assert.equal(fail[0].status, 'failed');
  assert.match(fail[0].detail, /lists 2 TABLE DATA entries/);
});

test('T-U1b A1 fails when pg_restore --list itself errors (truncated archive)', async () => {
  const findings = await runArchiveCheck({
    dumpFile: '/tmp/truncated.dump',
    execFile: async () => {
      throw new Error('pg_restore: error: did not find magic string in file header');
    },
  });
  assert.equal(findings[0].status, 'failed');
  assert.match(findings[0].detail, /did not find magic string/);
});

const schemaRoutes = ({ tables, indexes }) => [
  ['information_schema.tables', tables.map((table_name) => ({ table_name }))],
  ['pg_indexes', indexes.map((indexname) => ({ indexname }))],
];

test('T-U2 A2 fails on a missing critical index and names it', async () => {
  const findings = await runSchemaShapeCheck({
    sql: sqlStub(
      schemaRoutes({ tables: CRITICAL_TABLES, indexes: [CRITICAL_INDEXES[1]] }),
    ),
  });
  const missing = byId(findings, `a2-index-${CRITICAL_INDEXES[0]}`);
  assert.equal(missing.status, 'failed');
  assert.match(missing.detail, new RegExp(CRITICAL_INDEXES[0]));
});

test('T-U2b A2 records post-dump schema drift as informational, not failed', async () => {
  const findings = await runSchemaShapeCheck({
    sql: sqlStub(schemaRoutes({ tables: CRITICAL_TABLES, indexes: CRITICAL_INDEXES })),
    codeTables: [...CRITICAL_TABLES, 'brand_new_table'],
  });
  const drift = byId(findings, 'a2-schema-drift');
  assert.equal(drift.status, 'informational');
  assert.match(drift.detail, /brand_new_table/);
  assert.equal(summarize(findings).status, 'passed');
});

test('T-U3 A3 fails when the restored users table is empty', async () => {
  const findings = await runRowCountCheck({
    sql: async (text) => [{ n: text.includes('"users"') ? 0 : 5 }],
  });
  const users = byId(findings, 'a3-count-users');
  assert.equal(users.status, 'failed');
  assert.match(users.detail, /users has 0 rows/);
  assert.equal(byId(findings, 'a3-count-events').status, 'passed');
});

test('T-U4 A4 fails on zero orphans when the FK constraint is absent (vacuous guard)', async () => {
  const findings = await runReferentialCheck({
    sql: sqlStub([
      ['pg_constraint', []],
      ['LEFT JOIN events', [{ n: 0 }]],
    ]),
  });
  assert.equal(byId(findings, 'a4-orphans').status, 'passed');
  const fk = byId(findings, 'a4-fk-present');
  assert.equal(fk.status, 'failed');
  assert.match(fk.detail, /FK is MISSING/);
  assert.equal(summarize(findings).status, 'failed');
});

test('T-U5 A5 fails naming a sanitized table that carries rows', async () => {
  const findings = await runSanitizationCheck({
    sql: async (text) => [{ n: text.includes('"sessions"') ? 3 : 0 }],
  });
  const sessions = byId(findings, 'a5-empty-sessions');
  assert.equal(sessions.status, 'failed');
  assert.match(sessions.detail, /sessions carries 3 row\(s\)/);
});

test('T-U6 the classifier fatal branch wins even beside a benign line', () => {
  assert.equal(classifyRestoreStderr('').fatal, false);
  assert.equal(
    classifyRestoreStderr('pg_restore: warning: errors ignored on restore: 3').fatal,
    false,
  );
  const mixed = classifyRestoreStderr(
    [
      'pg_restore: warning: errors ignored on restore: 3',
      'pg_restore: error: could not read from input file: end of file',
    ].join('\n'),
  );
  assert.equal(mixed.fatal, true);
  assert.equal(mixed.fatalLines.length, 1);
  assert.match(mixed.fatalLines[0], /could not read from input file/);
});

test('T-U7 the D11 rails throw before any restore work is attempted', () => {
  let restoreCalls = 0;
  const drill = (databaseUrl) => {
    assertRails({ databaseUrl, dbName: 'raid_ledger' });
    restoreCalls += 1;
  };

  assert.throws(
    () => drill('postgresql://user:password@raid.gamernight.net:5432/raid_ledger'),
    /rail-1: drill DATABASE_URL host must be localhost/,
  );
  assert.throws(
    () => drill('postgresql://user:password@127.0.0.1:5432/production'),
    /rail-2: drill database must be "raid_ledger"/,
  );
  assert.equal(restoreCalls, 0, 'restore must never be reached when a rail trips');

  drill('postgresql://user:password@127.0.0.1:54321/raid_ledger');
  assert.equal(restoreCalls, 1);
});

test('T-U7b rail-2 rejects a drill URL that collides with the fetch host', () => {
  assert.throws(
    () =>
      assertRails({
        databaseUrl: 'postgresql://user:password@localhost:5432/raid_ledger',
        dbName: 'raid_ledger',
        forbiddenHosts: ['https://localhost'],
      }),
    /rail-2: drill host collides with fetch host/,
  );
});

/**
 * T-U8 (D7). The boot tier used to poll `/api/health` on a hardcoded :3000 —
 * a URL the API never serves (`main.ts` sets no global prefix;
 * `app.controller.ts` serves `/health` at the root) on a port the drill does
 * not own. Both halves are asserted here because both made the tier
 * unpassable.
 */
test('T-U8 the boot health URL targets the root /health on the drill port', () => {
  assert.equal(bootHealthUrl(34567), 'http://127.0.0.1:34567/health');
  assert.doesNotMatch(
    bootHealthUrl(41111),
    /\/api\/health/,
    'the API serves /health at the root — /api/health is a 404',
  );
  assert.notEqual(
    new URL(bootHealthUrl(41111)).port,
    '3000',
    'the drill must poll the port it handed the child, not a hardcoded 3000',
  );
});

test('T-U8b the boot health URL refuses a port the picker failed to produce', () => {
  for (const bad of ['', undefined, 0, 70000, 'abc']) {
    assert.throws(
      () => bootHealthUrl(bad),
      /boot-check: invalid API port/,
      `expected bootHealthUrl(${JSON.stringify(bad)}) to throw`,
    );
  }
});

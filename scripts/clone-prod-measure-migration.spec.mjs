// ROK-2263 L6 — scripts/lib/clone-prod-measure.mjs (D12): arg parsing, the
// scratch-DB URL guard, the journal-membership plan (refuse already-applied,
// CONCURRENTLY; flag drizzle's skip edge) and the psql script/report round trip.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  buildMeasureScript,
  buildReport,
  migrationHash,
  parseMeasureArgs,
  parseMeasureOutput,
  planMeasure,
  readTreeJournal,
  scratchDatabaseUrl,
  UsageError,
  usesConcurrently,
} from './lib/clone-prod-measure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'clone-prod-measure-migration.sh');
const LIB = join(HERE, 'lib', 'clone-prod-measure.mjs');

const BASE_ARGS = ['--dump', '/tmp/x.dump', '--migration', '0002_b', '--query', 'SELECT 1'];

describe('parseMeasureArgs', () => {
  it('parses every flag, repeats --query and strips trailing semicolons', () => {
    const cfg = parseMeasureArgs([...BASE_ARGS, '--query', 'SELECT 2 ;; ', '--tree', '/w']);
    assert.deepEqual(cfg, { dump: '/tmp/x.dump', migration: '0002_b', tree: '/w', queries: ['SELECT 1', 'SELECT 2'] });
  });

  it('accepts a tag given with .sql', () => {
    assert.equal(parseMeasureArgs(['--dump', 'latest', '--migration', '0002_b.sql', '--query', 'x']).migration, '0002_b');
  });

  for (const [label, argv, msg] of [
    ['missing --dump', ['--migration', '0002_b', '--query', 'x'], /--dump is required/],
    ['missing --migration', ['--dump', 'latest', '--query', 'x'], /--migration is required/],
    ['missing --query', ['--dump', 'latest', '--migration', '0002_b'], /at least one --query/],
    ['flag without value', ['--dump'], /--dump needs a value/],
    ['unknown flag', [...BASE_ARGS, '--force', 'y'], /unknown argument: --force/],
    ['non-tag migration', ['--dump', 'latest', '--migration', '../../etc/passwd', '--query', 'x'], /journal tag/],
    ['blank query', [...BASE_ARGS, '--query', ' ; '], /must not be empty/],
  ]) {
    it(`refuses ${label}`, () => {
      assert.throws(() => parseMeasureArgs(argv), (e) => e instanceof UsageError && msg.test(e.message));
    });
  }
});

describe('scratchDatabaseUrl', () => {
  it('swaps only the database name', () => {
    assert.equal(
      scratchDatabaseUrl('postgresql://u:p@localhost:5432/raid_ledger'),
      'postgresql://u:p@localhost:5432/rl_clone_scratch',
    );
  });

  it('refuses a DATABASE_URL that already names the scratch DB (never the main DB)', () => {
    assert.throws(() => scratchDatabaseUrl('postgresql://u@localhost/rl_clone_scratch'), /refusing/);
  });
});

describe('usesConcurrently', () => {
  it('detects CONCURRENTLY in code, ignores it in comments', () => {
    assert.equal(usesConcurrently('CREATE INDEX CONCURRENTLY i ON t (a);'), true);
    assert.equal(usesConcurrently('-- not CONCURRENTLY\nCREATE INDEX i ON t (a);'), false);
    assert.equal(usesConcurrently('/* CONCURRENTLY */ SELECT 1;'), false);
  });
});

const entries = [
  { tag: '0000_a', when: 100, hash: 'h0' },
  { tag: '0001_m', when: 200, hash: 'h1' },
  { tag: '0002_b', when: 300, hash: 'h2' },
];

describe('planMeasure (journal membership)', () => {
  it('refuses a migration whose hash is already in the dump journal', () => {
    const plan = planMeasure({ entries, applied: [{ hash: 'h2', created_at: 999 }], migration: '0002_b', sqlText: 'x' });
    assert.equal(plan.ok, false);
    assert.match(plan.error, /already in the dump's journal/);
  });

  it('refuses a migration whose `when` matches an applied created_at (edited after it ran)', () => {
    const plan = planMeasure({ entries, applied: [{ hash: 'zz', created_at: '300' }], migration: '0002_b', sqlText: 'x' });
    assert.match(plan.error ?? '', /already in the dump's journal/);
  });

  it('refuses a tag the tree journal lacks', () => {
    assert.match(planMeasure({ entries, applied: [], migration: '0009_z', sqlText: '' }).error ?? '', /not in the tree/);
  });

  it('refuses CONCURRENTLY with a clear error', () => {
    const plan = planMeasure({ entries, applied: [], migration: '0002_b', sqlText: 'CREATE INDEX CONCURRENTLY i ON t(a);' });
    assert.match(plan.error ?? '', /CONCURRENTLY.*transaction/);
  });

  it('lists earlier tree migrations the dump lacks as pending, in journal order', () => {
    const plan = planMeasure({ entries, applied: [{ hash: 'h0', created_at: 100 }], migration: '0002_b', sqlText: 'x' });
    assert.deepEqual(plan, { ok: true, migration: '0002_b', pending: ['0001_m'], drizzleWouldSkip: false, maxApplied: 100, warnings: [] });
  });

  it("flags a branch migration older than prod's newest applied one (drizzle would skip it)", () => {
    const applied = [{ hash: 'h0', created_at: 100 }, { hash: 'prod-only', created_at: 400 }];
    const plan = planMeasure({ entries, applied, migration: '0002_b', sqlText: 'x' });
    assert.equal(plan.ok, true);
    assert.equal(plan.drizzleWouldSkip, true);
    assert.match(plan.warnings[0], /when=300 <= prod's newest applied created_at=400.*SKIP/);
  });
});

describe('readTreeJournal', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'measure-journal-'));
    mkdirSync(join(dir, 'meta'));
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ entries: [{ idx: 0, tag: '0000_a', when: '100' }] }));
    writeFileSync(join(dir, '0000_a.sql'), 'CREATE TABLE a (id int);');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("hashes each .sql the way drizzle does (sha256 of the text) and numbers `when`", () => {
    assert.deepEqual(readTreeJournal(dir), [{ tag: '0000_a', when: 100, hash: migrationHash('CREATE TABLE a (id int);') }]);
    assert.match(migrationHash('x'), /^[0-9a-f]{64}$/);
  });
});

describe('measure script + report', () => {
  const queries = ['SELECT count(*) AS n FROM t', 'SELECT 1 AS one'];

  it('wraps the migration in BEGIN … ROLLBACK with ON_ERROR_STOP, before and after queries', () => {
    const sql = buildMeasureScript(queries, 'ALTER TABLE t ADD c int;');
    const order = ['\\set ON_ERROR_STOP on', 'BEGIN;', 'before:0', 'before:1', 'ALTER TABLE t', 'after:0', 'after:1', 'ROLLBACK;'];
    const positions = order.map((s) => sql.indexOf(s));
    assert.ok(positions.every((p) => p >= 0), `missing a piece: ${JSON.stringify(positions)}`);
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'pieces out of order');
    assert.equal(sql.includes('COMMIT'), false);
  });

  it('parses psql output into before/after rows and ignores migration noise', () => {
    const out = [
      '__RL_MEASURE__before:0', '[{"n":2}]', '__RL_MEASURE__before:1', '[{"one":1}]',
      '__RL_MEASURE__migration', 'stray NOTICE line',
      '__RL_MEASURE__after:0', '[{"n":3}]', '__RL_MEASURE__after:1', '[{"one":1}]', '',
    ].join('\n');
    assert.deepEqual(parseMeasureOutput(out, queries), {
      before: [{ sql: queries[0], rows: [{ n: 2 }] }, { sql: queries[1], rows: [{ one: 1 }] }],
      after: [{ sql: queries[0], rows: [{ n: 3 }] }, { sql: queries[1], rows: [{ one: 1 }] }],
    });
  });

  it('reports the psql error and keeps the before rows when the migration fails', () => {
    const report = buildReport({
      config: { migration: '0002_b', queries },
      plan: { pending: ['0001_m'], warnings: [] },
      stdout: '__RL_MEASURE__before:0\n[{"n":2}]\n',
      stderr: 'ERROR:  column "c" already exists\n',
      exitCode: 3,
    });
    assert.equal(report.error, 'ERROR:  column "c" already exists');
    assert.deepEqual(report.before, [{ sql: queries[0], rows: [{ n: 2 }] }]);
    assert.deepEqual(report.after, []);
    assert.deepEqual(report.pending_applied, ['0001_m']);
  });
});

describe('parseMeasureOutput edge cases (review fixes)', () => {
  const queries = ['SELECT n FROM t', 'SELECT 1 AS one'];

  it('parses a json_agg result that psql printed across several lines (>=2 rows)', () => {
    // psql -tAqX prints json_agg of 2+ rows with ", \n " between elements.
    const out = ['__RL_MEASURE__before:0', '[{"n":1}, ', ' {"n":2}]', '__RL_MEASURE__before:1', '[{"one":1}]', ''].join('\n');
    assert.deepEqual(parseMeasureOutput(out, queries).before, [
      { sql: queries[0], rows: [{ n: 1 }, { n: 2 }] },
      { sql: queries[1], rows: [{ one: 1 }] },
    ]);
  });

  it('keeps the psql error when a query fails right after its marker (no rows line)', () => {
    const report = buildReport({
      config: { migration: '0002_b', queries },
      plan: { pending: [], warnings: [] },
      stdout: '__RL_MEASURE__before:0\n[{"n":2}]\n__RL_MEASURE__before:1\n',
      stderr: 'ERROR:  relation "nope" does not exist\n',
      exitCode: 3,
    });
    assert.equal(report.error, 'ERROR:  relation "nope" does not exist');
    assert.deepEqual(report.before, [{ sql: queries[0], rows: [{ n: 2 }] }]);
  });

  it('aggregates with jsonb_agg so psql prints one line per result', () => {
    const sql = buildMeasureScript(queries, 'SELECT 1;');
    assert.match(sql, /jsonb_agg\(q\)/);
    assert.equal(/\bjson_agg\(/.test(sql), false, 'json_agg spans lines for 2+ rows');
  });
});

describe('CLI + script entry (no Docker reached)', () => {
  it('lib parse-args exits 2 with the usage on bad input', () => {
    const res = spawnSync('node', [LIB, 'parse-args', '--migration', '0002_b'], { encoding: 'utf8' });
    assert.equal(res.status, 2);
    assert.match(res.stderr, /--dump is required/);
  });

  it('the script refuses bad usage with exit 2 before touching Docker', () => {
    const res = spawnSync('bash', [SCRIPT, '--dump', 'latest', '--query', 'SELECT 1'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: tmpdir() },
    });
    assert.equal(res.status, 2, res.stderr);
    assert.match(res.stderr, /--migration is required/);
  });
});

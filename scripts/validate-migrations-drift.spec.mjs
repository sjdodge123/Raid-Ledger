/**
 * TDB:1167 — node:test spec for the snapshot-drift check in
 * scripts/validate-migrations.sh (`--drift-only`). drizzle-kit 0.31 has no
 * dry-run, so the check runs `generate` against a temp copy of the migrations
 * dir. These tests pin that (a) the real tree has no drift, (b) a schema edit
 * without `db:generate` fails with the SQL it would have emitted, (c) a
 * drizzle-kit crash (which still exits 0) is a failure, not a pass, and (d)
 * the real migrations dir is never written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts/validate-migrations.sh');
const MIGRATIONS = path.join(REPO_ROOT, 'api/src/drizzle/migrations');
const SCHEMA = path.join(REPO_ROOT, 'api/src/drizzle/schema');
const PG_CORE = path.join(REPO_ROOT, 'node_modules/drizzle-orm/pg-core');

const listMigrations = () =>
  [
    ...readdirSync(MIGRATIONS),
    ...readdirSync(path.join(MIGRATIONS, 'meta')).map((f) => `meta/${f}`),
  ].sort();

function runDriftOnly(extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (!('RL_DRIFT_SCHEMA' in extraEnv)) delete env.RL_DRIFT_SCHEMA;
  delete env.RL_DRIFT_MIGRATIONS_DIR;
  const res = spawnSync('bash', [SCRIPT, '--drift-only'], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

function withProbeSchema(body, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rl-drift-probe-'));
  try {
    const file = path.join(dir, 'probe.ts');
    writeFileSync(file, body);
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the real schema.ts matches the latest snapshot (no drift)', () => {
  const before = listMigrations();
  const { status, out } = runDriftOnly();
  assert.equal(status, 0, `expected no drift, got exit ${status}:\n${out}`);
  assert.match(out, /No snapshot drift/);
  assert.deepEqual(listMigrations(), before, 'the real migrations dir was written');
});

test('a schema edit without db:generate fails and shows the SQL it would emit', () => {
  const probe = [
    `import { integer, pgTable } from '${PG_CORE}';`,
    `export * from '${SCHEMA}';`,
    `export const driftProbe = pgTable('drift_probe', { id: integer('id') });`,
  ].join('\n');
  const before = listMigrations();
  const { status, out } = withProbeSchema(probe, (file) =>
    runDriftOnly({ RL_DRIFT_SCHEMA: file }),
  );
  assert.equal(status, 1, `expected drift failure, got exit ${status}:\n${out}`);
  assert.match(out, /Snapshot drift: schema\.ts differs from the latest snapshot/);
  assert.match(out, /CREATE TABLE "drift_probe"/);
  assert.deepEqual(listMigrations(), before, 'the real migrations dir was written');
});

test('a drizzle-kit crash (it still exits 0) fails the check instead of passing', () => {
  const missing = path.join(os.tmpdir(), 'rl-drift-no-such-schema.ts');
  const { status, out } = runDriftOnly({ RL_DRIFT_SCHEMA: missing });
  assert.equal(status, 1, `expected failure on a crashed generate, got exit ${status}:\n${out}`);
  assert.match(out, /did not report 'No schema changes'/);
});

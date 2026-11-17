/**
 * ROK-2206 AC 3 + AC 4: the per-worker setup against a REAL Postgres. Drives
 * `prepareTemplateDb` / `cloneWorkerDbs` directly on a scratch base DB on the
 * same server as this file's test app — never through the suite's own
 * globalSetup, and never on the run's real base or `_tpl`.
 *
 * AC 3: a row written into the base before setup is absent from every clone,
 *       and `<base>_tpl` is recreated each run (rows left in it never reach
 *       new clones).
 * AC 4: setup never drops, migrates or truncates the base.
 */
import postgres from 'postgres';
import { getTestApp } from './test-app';
import {
  cloneWorkerDbs,
  databaseName,
  prepareTemplateDb,
  templateDbName,
  withDatabase,
} from './integration-worker-dbs';
import { at } from './narrow';

const BASE = `rl2206_scratch_${process.pid}`;
const SCRATCH_DBS = [BASE, `${BASE}_tpl`, `${BASE}_w1`, `${BASE}_w2`];
const SETUP_TIMEOUT_MS = 240_000;

let serverUrl = '';
let baseUrl = '';

/** Run `fn` on a one-connection client to `url`, always closing it. */
async function onDb<T>(
  url: string,
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(url, { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function dropScratchDbs(): Promise<void> {
  await onDb(withDatabase(serverUrl, 'postgres'), async (admin) => {
    for (const name of SCRATCH_DBS) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });
}

/** True when the schema-qualified `relation` exists in the DB at `url`. */
async function hasRelation(url: string, relation: string): Promise<boolean> {
  return onDb(url, async (sql) => {
    const rows = await sql<{ present: boolean }[]>`
      SELECT to_regclass(${relation}::text) IS NOT NULL AS present`;
    return at(rows, 0).present;
  });
}

/** What setup must leave untouched in the base (AC 4). */
async function baseState(): Promise<Record<string, unknown>> {
  const markerRows = await onDb(baseUrl, async (sql) => {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM base_marker`;
    return at(rows, 0).n;
  });
  return {
    markerRows,
    migratedUsers: await hasRelation(baseUrl, 'public.users'),
    drizzleJournal: await hasRelation(baseUrl, 'drizzle.__drizzle_migrations'),
  };
}

/** Per clone: is it migrated, and did it inherit `table`? */
async function cloneState(
  urls: string[],
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const states: Array<Record<string, unknown>> = [];
  for (const url of urls) {
    states.push({
      db: databaseName(url),
      migratedUsers: await hasRelation(url, 'public.users'),
      [table]: await hasRelation(url, `public.${table}`),
    });
  }
  return states;
}

beforeAll(async () => {
  serverUrl = (await getTestApp()).connectionString;
  baseUrl = withDatabase(serverUrl, BASE);
  await dropScratchDbs();
  await onDb(withDatabase(serverUrl, 'postgres'), async (admin) => {
    await admin.unsafe(`CREATE DATABASE "${BASE}"`);
  });
  await onDb(baseUrl, async (sql) => {
    await sql`CREATE TABLE base_marker (id int PRIMARY KEY)`;
    await sql`INSERT INTO base_marker VALUES (1)`;
  });
}, 60_000);

afterAll(async () => {
  if (serverUrl) await dropScratchDbs();
});

describe('ROK-2206 per-worker DB setup (real Postgres)', () => {
  it(
    'clones a migrated template that carries nothing from the base, and leaves the base as it was (AC 3, AC 4)',
    async () => {
      await prepareTemplateDb(baseUrl);
      const clones = await cloneWorkerDbs(baseUrl, 2);

      expect(await cloneState(clones, 'base_marker')).toEqual([
        { db: `${BASE}_w1`, migratedUsers: true, base_marker: false },
        { db: `${BASE}_w2`, migratedUsers: true, base_marker: false },
      ]);
      expect(await baseState()).toEqual({
        markerRows: 1,
        migratedUsers: false,
        drizzleJournal: false,
      });
    },
    SETUP_TIMEOUT_MS,
  );

  it(
    'recreates <base>_tpl on every run, so a table left in it never reaches new clones (AC 3)',
    async () => {
      const tplUrl = withDatabase(baseUrl, templateDbName(baseUrl));
      await prepareTemplateDb(baseUrl);
      await onDb(tplUrl, async (sql) => {
        await sql`CREATE TABLE stale_marker (id int)`;
      });

      await prepareTemplateDb(baseUrl);
      const clones = await cloneWorkerDbs(baseUrl, 2);

      expect(await cloneState([tplUrl, ...clones], 'stale_marker')).toEqual([
        { db: `${BASE}_tpl`, migratedUsers: true, stale_marker: false },
        { db: `${BASE}_w1`, migratedUsers: true, stale_marker: false },
        { db: `${BASE}_w2`, migratedUsers: true, stale_marker: false },
      ]);
    },
    SETUP_TIMEOUT_MS,
  );
});

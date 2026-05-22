/**
 * ROK-1343 M2: loud-failure integration test for `runMigrations`.
 *
 * Confirms that the post-restore migration step propagates a real
 * SQL error when a migration is malformed, instead of silently
 * swallowing it. The current implementation (`backup.helpers.ts:129`)
 * shells out to `npx drizzle-kit migrate`, which has a known
 * upstream bug (drizzle-team/drizzle-orm#5601, #5521, #5520) where
 * `MigrateProgress.render` ignores the `err` argument on the
 * "rejected" status — the CLI exits 1 with empty stderr.
 *
 * TDD: this spec MUST fail today. After the M2 swap to the
 * programmatic `migrate()` API, the Postgres syntax error will
 * surface in the thrown Error's message.
 *
 * Gating: same `SKIP_BACKUP_INTEGRATION` env gate the existing
 * backup integration tests use — these tests shell out to
 * `pg_dump`/`pg_restore` for the broader backup suite, and the
 * Testcontainers Postgres image only resolves locally when Docker
 * is up.
 */
import postgres from 'postgres';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { runMigrations } from './backup.helpers';

const SKIP_BACKUP_INTEGRATION = process.env.SKIP_BACKUP_INTEGRATION === '1';
const describeLoudFailure = SKIP_BACKUP_INTEGRATION ? describe.skip : describe;

// Resolve the api workspace root from this file's location.
//   __dirname → .../api/src/backup
//   apiRoot   → .../api
const API_ROOT = path.resolve(__dirname, '../..');

/**
 * Build a tmp migrations folder containing one VALID migration + one
 * INTENTIONALLY BROKEN migration. Folder shape matches what
 * `drizzle-orm/postgres-js/migrator` expects: `<root>/meta/_journal.json`
 * + `<root>/<tag>.sql` per entry.
 *
 * Returns the absolute path of the created folder.
 */
function buildBrokenMigrationsFolder(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-1343-broken-migs-'));
  const metaDir = path.join(dir, 'meta');
  fs.mkdirSync(metaDir, { recursive: true });

  // Migration 1 — VALID (creates a sentinel table).
  const validTag = '0000_rok_1343_valid_sentinel';
  fs.writeFileSync(
    path.join(dir, `${validTag}.sql`),
    'CREATE TABLE rok_1343_sentinel (id integer PRIMARY KEY);',
  );

  // Migration 2 — INTENTIONALLY BROKEN (Postgres syntax error).
  const brokenTag = '0001_rok_1343_broken_syntax';
  fs.writeFileSync(
    path.join(dir, `${brokenTag}.sql`),
    'THIS IS NOT VALID SQL FOR ROK-1343 SYNTAX ERROR;',
  );

  // _journal.json — drizzle-kit format v7.
  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: [
      {
        idx: 0,
        version: '7',
        when: 1700000000000,
        tag: validTag,
        breakpoints: true,
      },
      {
        idx: 1,
        version: '7',
        when: 1700000001000,
        tag: brokenTag,
        breakpoints: true,
      },
    ],
  };
  fs.writeFileSync(
    path.join(metaDir, '_journal.json'),
    JSON.stringify(journal, null, 2),
  );

  return dir;
}

async function ensureDrizzleSchema(connectionString: string): Promise<void> {
  // drizzle-orm's migrator creates `drizzle.__drizzle_migrations` on its
  // own, but only after a successful first migration runs. To make the
  // failure deterministic the helper just ensures the schema exists; we
  // don't need to pre-populate the metadata table.
  const client = postgres(connectionString, { max: 1 });
  try {
    await client.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle;');
  } finally {
    await client.end();
  }
}

describeLoudFailure(
  'ROK-1343 runMigrations propagates SQL errors loudly (integration)',
  () => {
    let container: StartedPostgreSqlContainer;
    let connectionString: string;
    let migrationsDir: string;
    const savedEnv: Record<string, string | undefined> = {};

    beforeAll(async () => {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
        .withDatabase('raid_ledger_rok_1343')
        .withUsername('test')
        .withPassword('test')
        .withStartupTimeout(60_000)
        .start();
      connectionString = container.getConnectionUri();
      await ensureDrizzleSchema(connectionString);

      // Snapshot env vars the wrapper may read; restored in afterAll.
      savedEnv.DATABASE_URL = process.env.DATABASE_URL;
      savedEnv.MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER;
      savedEnv.NODE_ENV = process.env.NODE_ENV;
    }, 90_000);

    afterAll(async () => {
      if (container) {
        await container.stop();
      }
      if (migrationsDir) {
        fs.rmSync(migrationsDir, { recursive: true, force: true });
      }
      // Restore env exactly as it was.
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = val;
        }
      }
    });

    beforeEach(() => {
      migrationsDir = buildBrokenMigrationsFolder();
      process.env.DATABASE_URL = connectionString;
      process.env.MIGRATIONS_FOLDER = migrationsDir;
      // Force the dev branch of runMigrations (NODE_ENV !== 'production').
      // M2 only rewires that branch — the Docker/production branch already
      // routes through the programmatic runner.
      process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
      if (migrationsDir) {
        fs.rmSync(migrationsDir, { recursive: true, force: true });
      }
    });

    it('throws an Error whose message contains the underlying SQL error', async () => {
      // The current implementation shells to `drizzle-kit migrate`, which
      // exits 1 with empty stderr — execFile rejects with a message like
      // `Command failed: npx drizzle-kit migrate` and NO SQL context.
      //
      // After M2, runMigrations routes through the programmatic
      // `migrate()` from drizzle-orm/postgres-js/migrator, which throws a
      // postgres-js error whose `.message` includes the underlying
      // Postgres parse failure ("syntax error at or near …").
      let caught: unknown;
      try {
        await runMigrations(API_ROOT);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      // The exact Postgres wording is "syntax error at or near \"THIS\"".
      // Match the stable substring "syntax error" — the upstream
      // wording is locale-independent in en_US builds and has been
      // stable across postgres-js versions.
      expect(message).toMatch(/syntax error/i);
    }, 60_000);

    it('exposes the broken migration tag in the error context', async () => {
      // Stronger guarantee: the failure surfaces enough context for the
      // operator to locate the file. Either the broken tag itself or
      // drizzle's `error: failed to run migration ...` framing must
      // appear in the message.
      let caught: unknown;
      try {
        await runMigrations(API_ROOT);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      // Either the broken tag is referenced OR the literal bad token
      // from the SQL appears — both are signals the programmatic
      // migrator surfaced the failure rather than the CLI swallowing it.
      expect(message).toMatch(/(0001_rok_1343_broken_syntax|THIS)/);
    }, 60_000);
  },
);

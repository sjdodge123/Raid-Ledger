/**
 * ROK-1322: integration proof that the restore-time migration path
 * (`backup.helpers.ts::runMigrations`) now runs through the instrumented boot
 * runner `runBootMigrations`, so restore gets the SAME invariant as deploy boot:
 *
 *   (a) `games_dedup_audit` is refreshed from the live `games` table BEFORE the
 *       drizzle migrate runs (the real 2026-05-14 incident-prevention — a data
 *       migration consuming a stale audit would blow up), AND
 *   (b) a broken migration propagates LOUDLY (the pg parse error surfaces on the
 *       thrown error) instead of being silently swallowed.
 *
 * The Sentry `restore-migration` failure-tag capture is proven DETERMINISTICALLY
 * in the unit spec `run-migrations-with-sentry.spec.ts`. It is intentionally NOT
 * asserted here: the integration config's `setupFilesAfterEnv` boots the NestJS
 * app, which imports the REAL `@sentry/nestjs` before any per-file `jest.mock`
 * could take effect — so a `@sentry` mock in this suite is unreliable. The
 * refresh + loud-propagation effects below need no mock.
 *
 * Self-contained: spins its OWN throwaway Postgres container (does not touch the
 * shared TestApp singleton). Gated by `SKIP_BACKUP_INTEGRATION` like the other
 * backup integration specs — deferred to CI when Docker/pg tooling is absent.
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
const describeRestore = SKIP_BACKUP_INTEGRATION ? describe.skip : describe;

// __dirname → .../api/src/backup ; apiRoot → .../api
const API_ROOT = path.resolve(__dirname, '../..');

/** Minimal DDL for the two tables `refreshDedupAudit` reads/writes. */
async function createDedupTables(
  client: ReturnType<typeof postgres>,
): Promise<void> {
  await client.unsafe(`
    CREATE TABLE games (
      id serial PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL,
      igdb_id integer,
      itad_game_id text,
      steam_app_id integer,
      cached_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE games_dedup_audit (
      id serial PRIMARY KEY,
      match_type text NOT NULL,
      match_key text NOT NULL,
      canonical_game_id integer NOT NULL,
      dup_game_ids integer[] NOT NULL,
      group_size integer NOT NULL,
      downstream_counts jsonb NOT NULL,
      unique_conflicts jsonb NOT NULL,
      snapshot_at timestamptz NOT NULL
    );
  `);
}

/** Drop-and-recreate public/drizzle schemas + the dedup tables (clean slate). */
async function resetDatabase(
  client: ReturnType<typeof postgres>,
): Promise<void> {
  await client.unsafe(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  );
  await createDedupTables(client);
}

/**
 * Seed a name-only duplicate pair + a STALE audit row that references an
 * unrelated match_key — exactly the ROK-1278 shape where the real duplicate was
 * uncatalogued. Returns the two game ids.
 */
async function seedUncataloguedDup(
  client: ReturnType<typeof postgres>,
): Promise<{ canon: number; dup: number }> {
  const rows = (await client`
    INSERT INTO games (name, slug) VALUES
      ('Dup Restore A', 'dup-restore-a-canon'),
      ('Dup Restore A', 'dup-restore-a-dup')
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  const canon = rows[0].id;
  const dup = rows[1].id;
  await client`
    INSERT INTO games_dedup_audit (
      match_type, match_key, canonical_game_id, dup_game_ids,
      group_size, downstream_counts, unique_conflicts, snapshot_at
    ) VALUES (
      'name', 'stale', ${canon}, ARRAY[${dup}]::int[],
      2, '{}'::jsonb, '{}'::jsonb, NOW()
    )
  `;
  return { canon, dup };
}

/** Write a drizzle-kit v7 migrations folder with the given .sql entries. */
function buildMigrationsFolder(
  entries: Array<{ tag: string; sql: string }>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-1322-restore-migs-'));
  fs.mkdirSync(path.join(dir, 'meta'), { recursive: true });
  const journalEntries = entries.map((e, idx) => {
    fs.writeFileSync(path.join(dir, `${e.tag}.sql`), e.sql);
    return {
      idx,
      version: '7',
      when: 1700000000000 + idx * 1000,
      tag: e.tag,
      breakpoints: true,
    };
  });
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify(
      { version: '7', dialect: 'postgresql', entries: journalEntries },
      null,
      2,
    ),
  );
  return dir;
}

describeRestore(
  'ROK-1322 restore path via runBootMigrations (integration)',
  () => {
    let container: StartedPostgreSqlContainer;
    let connectionString: string;
    let client: ReturnType<typeof postgres>;
    let migrationsDir: string;
    const savedEnv: Record<string, string | undefined> = {};

    beforeAll(async () => {
      container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
        .withDatabase('raid_ledger_rok_1322')
        .withUsername('test')
        .withPassword('test')
        .withStartupTimeout(60_000)
        .start();
      connectionString = container.getConnectionUri();
      client = postgres(connectionString, { max: 1 });
      savedEnv.MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER;
      savedEnv.DATABASE_URL = process.env.DATABASE_URL;
    }, 90_000);

    afterAll(async () => {
      if (client) await client.end({ timeout: 5 });
      if (container) await container.stop();
      for (const [key, val] of Object.entries(savedEnv)) {
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
      }
    });

    beforeEach(async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await resetDatabase(client);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      if (migrationsDir) {
        fs.rmSync(migrationsDir, { recursive: true, force: true });
      }
    });

    it('refreshes games_dedup_audit from live games on the restore path (AC#3)', async () => {
      await seedUncataloguedDup(client);
      migrationsDir = buildMigrationsFolder([
        {
          tag: '0000_rok_1322_valid',
          sql: 'CREATE TABLE rok1322_restore_ok (id integer);',
        },
      ]);
      process.env.MIGRATIONS_FOLDER = migrationsDir;

      await runMigrations(API_ROOT, connectionString);

      // The stale row is gone; the audit now reflects the REAL uncatalogued dup.
      const audit = (await client`
        SELECT match_type, match_key, dup_game_ids
        FROM games_dedup_audit
      `) as unknown as Array<{
        match_type: string;
        match_key: string;
        dup_game_ids: number[];
      }>;
      expect(audit).toHaveLength(1);
      expect(audit[0].match_type).toBe('name');
      expect(audit[0].match_key).not.toBe('stale');
      expect(audit[0].dup_game_ids).toHaveLength(1);

      // The migrate step actually ran (proves refresh preceded a real migrate).
      const ok = (await client`
        SELECT to_regclass('public.rok1322_restore_ok') AS oid
      `) as unknown as Array<{ oid: string | null }>;
      expect(ok[0].oid).not.toBeNull();
    }, 60_000);

    it('propagates a broken migration loudly on the restore path (AC#4)', async () => {
      migrationsDir = buildMigrationsFolder([
        {
          tag: '0000_rok_1322_valid',
          sql: 'CREATE TABLE rok1322_restore_ok (id integer);',
        },
        {
          tag: '0001_rok_1322_broken',
          sql: 'THIS IS NOT VALID SQL FOR ROK-1322;',
        },
      ]);
      process.env.MIGRATIONS_FOLDER = migrationsDir;

      const caught = await runMigrations(API_ROOT, connectionString).catch(
        (err: unknown) => err,
      );

      // The pg parse failure surfaces on the error (drizzle wraps it as the
      // `.cause` under a "Failed query:" message) — NOT silently swallowed.
      expect(caught).toBeInstanceOf(Error);
      const combined = `${(caught as Error).message} ${
        ((caught as Error).cause as Error | undefined)?.message ?? ''
      }`;
      expect(combined).toMatch(/syntax error/i);
    }, 60_000);
  },
);

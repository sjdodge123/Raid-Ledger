/**
 * ROK-1333 regression guard.
 *
 * Asserts the production `raid_ledger` role can call
 * `pg_stat_statements_reset()` after the GRANT migration runs. Before
 * 0144_grant_pg_stat_statements_reset_execute.sql, the hourly digest cron
 * (ROK-1273) hit `permission denied for function pg_stat_statements_reset`
 * 14 times/day in prod and the digest stayed cumulative-since-boot — exactly
 * the bug ROK-1273 was meant to fix.
 *
 * The migration itself runs as a no-op in the Testcontainers/CI env because
 * the `raid_ledger` role only exists in prod (init-db.sh creates it). This
 * spec rebuilds the prod role + privilege shape against the test DB, then
 * opens a NEW connection as that role and exercises the reset call. The
 * third assertion drives `SlowQueriesService.appendDigestToLog()` end-to-end
 * with the bot connection swapped to `raid_ledger`, proving the production
 * path produces no `pg_stat_statements_reset failed` warn lines.
 *
 * Probe-and-skip: same pattern as slow-queries.service.integration.spec.ts.
 * When `pg_stat_statements` is not preloaded (CI service container, plain
 * Testcontainers), every test is a no-op.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import postgres from 'postgres';
import * as fs from 'node:fs';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import * as schema from '../drizzle/schema';
import { SlowQueriesService } from './slow-queries.service';

type ExtensionRow = { extname: string } & Record<string, unknown>;
type HasPrivilegeRow = { has_privilege: boolean } & Record<string, unknown>;

const TEST_ROLE = 'rok_1333_raid_ledger';

async function isPgStatStatementsAvailable(testApp: TestApp): Promise<boolean> {
  try {
    const rows = await testApp.db.execute<ExtensionRow>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements'`,
    );
    if (rows.length === 0) return false;
    await testApp.db.execute(sql`SELECT pg_stat_statements_reset()`);
    return true;
  } catch {
    return false;
  }
}

function buildRaidLedgerConnectionString(baseUri: string): string {
  // baseUri looks like postgres://test:test@host:port/raid_ledger_test
  const url = new URL(baseUri);
  url.username = TEST_ROLE;
  url.password = TEST_ROLE;
  return url.toString();
}

async function provisionRaidLedgerRole(testApp: TestApp): Promise<void> {
  // Mirror production: create the raid_ledger role and apply the GRANT the
  // migration applies in prod (EXECUTE on pg_stat_statements_reset). The
  // narrower per-function grant is intentional — pg_read_all_stats alone does
  // NOT confer EXECUTE on this function in PG 16 (verified 2026-05-23). The
  // setup must mirror the migration EXACTLY so the test is a true regression
  // guard for the production path. Idempotent — safe to re-run.
  await testApp.db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rok_1333_raid_ledger') THEN
        CREATE ROLE rok_1333_raid_ledger LOGIN PASSWORD 'rok_1333_raid_ledger';
      END IF;
    END
    $$;
  `);
  await testApp.db.execute(
    sql`GRANT CONNECT ON DATABASE raid_ledger_test TO rok_1333_raid_ledger`,
  );
  await testApp.db.execute(
    sql`GRANT EXECUTE ON FUNCTION pg_stat_statements_reset(oid, oid, bigint) TO rok_1333_raid_ledger`,
  );
}

async function dropRaidLedgerRole(testApp: TestApp): Promise<void> {
  try {
    await testApp.db.execute(
      sql`REVOKE EXECUTE ON FUNCTION pg_stat_statements_reset(oid, oid, bigint) FROM rok_1333_raid_ledger`,
    );
  } catch {
    /* role may already be gone */
  }
  try {
    await testApp.db.execute(sql`DROP ROLE IF EXISTS rok_1333_raid_ledger`);
  } catch {
    /* ignore */
  }
}

async function runAppendDigestAndCollectWarns(
  service: SlowQueriesService,
): Promise<{ written: boolean; warns: string[] }> {
  const warns: string[] = [];
  const warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation((message: unknown) => {
      warns.push(String(message));
    });
  try {
    try {
      await fs.promises.unlink(service.getLogFilePath());
    } catch {
      /* nothing to unlink */
    }
    const written = await service.appendDigestToLog();
    return { written, warns };
  } finally {
    warnSpy.mockRestore();
  }
}

function describeReset() {
  let testApp: TestApp;
  let extensionAvailable = false;
  let raidLedgerClient: ReturnType<typeof postgres> | null = null;
  let raidLedgerDb: PostgresJsDatabase<typeof schema> | null = null;

  beforeAll(async () => {
    testApp = await getTestApp();
    extensionAvailable = await isPgStatStatementsAvailable(testApp);
    if (!extensionAvailable) return;
    const baseConnUri =
      testApp.container?.getConnectionUri() ?? process.env.DATABASE_URL ?? '';
    if (!baseConnUri) return;
    await provisionRaidLedgerRole(testApp);
    raidLedgerClient = postgres(buildRaidLedgerConnectionString(baseConnUri), {
      max: 2,
    });
    raidLedgerDb = drizzle(raidLedgerClient, { schema });
  });

  afterAll(async () => {
    if (raidLedgerClient) await raidLedgerClient.end({ timeout: 5 });
    if (extensionAvailable) await dropRaidLedgerRole(testApp);
  });

  it('grants raid_ledger EXECUTE on pg_stat_statements_reset()', async () => {
    if (!extensionAvailable || !raidLedgerDb) return;
    // has_function_privilege uses regprocedure-style text-form lookup,
    // which is strict about declared arity (does NOT apply DEFAULT
    // substitution like runtime SELECT does). The only signature shipping
    // with pg_stat_statements 1.7+ on PG 12+ is (oid, oid, bigint); using
    // the 0-arg form 'pg_stat_statements_reset()' throws
    // `function ... does not exist`. Match the exact form the GRANT uses.
    const rows = await raidLedgerDb.execute<HasPrivilegeRow>(
      sql`SELECT has_function_privilege(
            current_user,
            'pg_stat_statements_reset(oid, oid, bigint)',
            'EXECUTE'
          ) AS has_privilege`,
    );
    expect(rows[0]?.has_privilege).toBe(true);
  });

  it('lets raid_ledger call pg_stat_statements_reset() without error', async () => {
    if (!extensionAvailable || !raidLedgerDb) return;
    // The bug surfaced as a thrown `permission denied for function
    // pg_stat_statements_reset`. If the GRANT path regresses this throws.
    await expect(
      raidLedgerDb.execute(sql`SELECT pg_stat_statements_reset()`),
    ).resolves.not.toThrow();
  });

  it('appendDigestToLog completes without a pg_stat_statements_reset warn', async () => {
    if (!extensionAvailable || !raidLedgerDb) return;
    const configService = testApp.app.get(ConfigService);
    const service = new SlowQueriesService(raidLedgerDb, configService);
    const { written, warns } = await runAppendDigestAndCollectWarns(service);
    expect(written).toBe(true);
    const offending = warns.filter((m) =>
      m.includes('pg_stat_statements_reset failed'),
    );
    expect(offending).toEqual([]);
  });
}

describe('pg_stat_statements_reset privilege (ROK-1333)', () =>
  describeReset());

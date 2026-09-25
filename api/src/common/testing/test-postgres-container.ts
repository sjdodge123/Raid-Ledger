/**
 * The integration suite's Postgres Testcontainer — one definition shared by
 * the jest `globalSetup` (one container per jest process) and the per-file
 * fallback in `test-app.ts::provisionDatabase`.
 *
 * Preloads pg_stat_statements so the ROK-1333 + ROK-1156 regression specs can
 * exercise the EXECUTE-grant path instead of self-skipping via
 * isPgStatStatementsAvailable. The extension is preloaded in prod
 * (Dockerfile.allinone:226) and the test container must mirror that shape to
 * be a true regression guard.
 */
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

/**
 * Env var the jest `globalSetup` publishes the shared container's URI under.
 * Deliberately NOT `DATABASE_URL`: AppModule's ConfigModule loads api/.env
 * (the operator's live `raid-ledger-db`) into `DATABASE_URL`, and
 * integration-setup.ts deletes it off-CI for exactly that reason. A dedicated
 * name can only ever hold a URI this suite created. ROK-1527.
 */
export const SHARED_TEST_DB_URL_ENV = 'RL_INTEGRATION_DB_URL';

/**
 * Set ONLY by `integration-global-setup.ts`, alongside the URL. A shared URL
 * without this marker (a shell export, an `api/.env` line) is never trusted —
 * the suite truncates whatever database it is pointed at.
 */
export const SHARED_TEST_DB_OWNER_ENV = 'RL_INTEGRATION_DB_OWNER';
export const SHARED_TEST_DB_OWNER = 'jest-global-setup';

/** The shared URL, but only when this process's globalSetup created it. */
export function ownedSharedTestDbUrl(): string | undefined {
  if (process.env[SHARED_TEST_DB_OWNER_ENV] !== SHARED_TEST_DB_OWNER) return undefined;
  return process.env[SHARED_TEST_DB_URL_ENV] || undefined;
}

export function startTestPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('raid_ledger_test')
    .withUsername('test')
    .withPassword('test')
    .withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
      '-c',
      'pg_stat_statements.track=all',
    ])
    .withStartupTimeout(60_000)
    .start();
}

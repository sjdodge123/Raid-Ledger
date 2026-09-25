/**
 * Jest `globalSetup` for the integration suite. ROK-1527.
 *
 * Off-CI (local + the rl-infra fleet runner) every spec file used to start its
 * OWN Postgres Testcontainer from inside its jest sandbox. Testcontainers
 * leaves a `logs({ follow: true })` docker-modem stream and the Ryuk reaper's
 * TCP socket alive, both created in that sandbox's realm, so every finished
 * file's realm stayed pinned (~58 MB/file, 51/51 realms alive at file 52).
 *
 * This starts ONE container per jest process, in the OUTER realm, and hands
 * its URI to every spec file via `SHARED_TEST_DB_URL_ENV` — the same
 * one-shared-DB shape GitHub CI already runs with its `postgres` service.
 * Migrations still run per file in `test-app.ts::setupDatabase`, exactly as
 * on CI (the migrator is idempotent).
 *
 * CI (`CI=true` + `DATABASE_URL`) is untouched: no container is started.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  SHARED_TEST_DB_OWNER,
  SHARED_TEST_DB_OWNER_ENV,
  SHARED_TEST_DB_URL_ENV,
  startTestPostgres,
} from './test-postgres-container';

/** globalSetup and globalTeardown share the outer realm's globalThis. */
export const CONTAINER_KEY = '__rl_integration_pg_container';

export type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: StartedPostgreSqlContainer;
};

export default async function integrationGlobalSetup(): Promise<void> {
  // Never inherit a shared URL: only one this setup creates is trusted.
  delete process.env[SHARED_TEST_DB_URL_ENV];
  delete process.env[SHARED_TEST_DB_OWNER_ENV];
  if (process.env.CI === 'true' && process.env.DATABASE_URL) return;
  const container = await startTestPostgres();
  (globalThis as GlobalWithContainer)[CONTAINER_KEY] = container;
  process.env[SHARED_TEST_DB_URL_ENV] = container.getConnectionUri();
  process.env[SHARED_TEST_DB_OWNER_ENV] = SHARED_TEST_DB_OWNER;
}

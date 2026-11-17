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
 * Off-CI, migrations still run per file in `test-app.ts::setupDatabase` (the
 * migrator is idempotent).
 *
 * CI (`CI=true` + `DATABASE_URL`): no container is started. The shard's one
 * service DB is migrated ONCE here and its URL recorded, so every spec file
 * skips its own `migrate()` (ROK-2196). The env var reaches the test files:
 * jest runs globalSetup in the parent before the test realms/workers exist.
 *
 * ROK-2206 (`RL_INTEGRATION_WORKERS` >= 2, both paths): the base DB is left
 * alone; a fresh `<base>_tpl` is migrated and cloned once per worker
 * (`integration-worker-dbs.ts`). Flag off = the paths above, unchanged.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  SHARED_TEST_DB_OWNER,
  SHARED_TEST_DB_OWNER_ENV,
  SHARED_TEST_DB_URL_ENV,
  startTestPostgres,
} from './test-postgres-container';
import {
  MIGRATED_TEST_DB_URL_ENV,
  markTestDbMigrated,
  runTestMigrations,
} from './integration-migrations';
import {
  WORKER_DB_URLS_ENV,
  cloneWorkerDbs,
  prepareTemplateDb,
  requestedWorkers,
} from './integration-worker-dbs';

/** globalSetup and globalTeardown share the outer realm's globalThis. */
export const CONTAINER_KEY = '__rl_integration_pg_container';
/** ROK-2206: base URL + worker count, so teardown can drop `_tpl`/`_wN`. */
export const WORKER_DBS_KEY = '__rl_integration_worker_dbs';

export type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: StartedPostgreSqlContainer;
  [WORKER_DBS_KEY]?: { baseUrl: string; workers: number };
};

export default async function integrationGlobalSetup(): Promise<void> {
  // Never inherit a shared URL: only one this setup creates is trusted.
  delete process.env[SHARED_TEST_DB_URL_ENV];
  delete process.env[SHARED_TEST_DB_OWNER_ENV];
  delete process.env[MIGRATED_TEST_DB_URL_ENV];
  delete process.env[WORKER_DB_URLS_ENV];
  const ciDbUrl = process.env.DATABASE_URL;
  if (process.env.CI === 'true' && ciDbUrl) {
    if (requestedWorkers() > 1) return prepareWorkerDbs(ciDbUrl);
    await runTestMigrations(ciDbUrl);
    markTestDbMigrated(ciDbUrl);
    return;
  }
  const container = await startTestPostgres();
  (globalThis as GlobalWithContainer)[CONTAINER_KEY] = container;
  process.env[SHARED_TEST_DB_URL_ENV] = container.getConnectionUri();
  process.env[SHARED_TEST_DB_OWNER_ENV] = SHARED_TEST_DB_OWNER;
  if (requestedWorkers() > 1) {
    await prepareWorkerDbs(container.getConnectionUri());
  }
}

/**
 * ROK-2206 per-worker mode: recreate + migrate `<base>_tpl`, clone it once
 * per worker, and record ONLY the template's clones as migrated. The base DB
 * itself is never dropped, migrated or truncated here.
 */
async function prepareWorkerDbs(baseUrl: string): Promise<void> {
  const workers = requestedWorkers();
  (globalThis as GlobalWithContainer)[WORKER_DBS_KEY] = { baseUrl, workers };
  await prepareTemplateDb(baseUrl);
  const urls = await cloneWorkerDbs(baseUrl, workers);
  process.env[WORKER_DB_URLS_ENV] = urls.join(' ');
  markTestDbMigrated(urls.join(' '));
}

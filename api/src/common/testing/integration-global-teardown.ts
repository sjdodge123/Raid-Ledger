/**
 * Jest `globalTeardown` for the integration suite: stops the shared Postgres
 * container `integration-global-setup.ts` started (a no-op on CI, where none
 * was). ROK-1527.
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { CONTAINER_KEY } from './integration-global-setup';

type GlobalWithContainer = typeof globalThis & {
  [CONTAINER_KEY]?: StartedPostgreSqlContainer;
};

export default async function integrationGlobalTeardown(): Promise<void> {
  const g = globalThis as GlobalWithContainer;
  const container = g[CONTAINER_KEY];
  if (!container) return;
  delete g[CONTAINER_KEY];
  await container.stop();
}

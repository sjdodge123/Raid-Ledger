/**
 * Jest `globalTeardown` for the integration suite: stops the shared Postgres
 * container `integration-global-setup.ts` started (a no-op on CI, where none
 * was). ROK-1527.
 */
import {
  CONTAINER_KEY,
  type GlobalWithContainer,
} from './integration-global-setup';

export default async function integrationGlobalTeardown(): Promise<void> {
  const g = globalThis as GlobalWithContainer;
  const container = g[CONTAINER_KEY];
  if (!container) return;
  delete g[CONTAINER_KEY];
  await container.stop();
}

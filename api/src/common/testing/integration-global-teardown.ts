/**
 * Jest `globalTeardown` for the integration suite: stops the shared Postgres
 * container `integration-global-setup.ts` started (a no-op on CI, where none
 * was). ROK-1527.
 *
 * ROK-2206: on a persistent server (CI service / fleet sidecar, no container)
 * per-worker mode also drops the `<base>_tpl` and `<base>_wN` DBs it made.
 * Best effort: a leftover DB is recreated by the next run's setup anyway, so
 * a failed drop warns instead of failing a green run.
 */
import {
  CONTAINER_KEY,
  WORKER_DBS_KEY,
  type GlobalWithContainer,
} from './integration-global-setup';
import { dropWorkerDbs } from './integration-worker-dbs';

async function dropWorkerDbsQuietly(g: GlobalWithContainer): Promise<void> {
  const made = g[WORKER_DBS_KEY];
  delete g[WORKER_DBS_KEY];
  if (!made) return;
  try {
    await dropWorkerDbs(made.baseUrl, made.workers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`ROK-2206: could not drop per-worker DBs: ${msg}`);
  }
}

export default async function integrationGlobalTeardown(): Promise<void> {
  const g = globalThis as GlobalWithContainer;
  const container = g[CONTAINER_KEY];
  if (!container) return dropWorkerDbsQuietly(g);
  delete g[CONTAINER_KEY];
  delete g[WORKER_DBS_KEY];
  await container.stop();
}

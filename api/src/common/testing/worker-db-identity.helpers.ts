/**
 * ROK-2206 AC 6: shared body of the `worker-db-identity-a/b` carrier pair.
 * Under RL_INTEGRATION_WORKERS >= 2 each file asserts its worker is connected
 * to the clone its `JEST_WORKER_ID` names. Run with
 * `RL_INTEGRATION_IDLE_MEMORY=1MB` so jest recycles a worker after every
 * file: a recycled worker that came back with a different or out-of-range id
 * would land on another worker's clone or on the unmigrated base.
 *
 * At 1 worker there are no clones, so the property does not exist and the
 * block is skipped (with the reason in its title) — not a weakened assertion.
 */
import { sql } from 'drizzle-orm';
import { getTestApp } from './test-app';
import { databaseName, requestedWorkers } from './integration-worker-dbs';
import { at } from './narrow';

export function describeWorkerDbIdentity(carrier: string): void {
  const perWorker = requestedWorkers() > 1;
  const run = perWorker ? describe : describe.skip;
  const reason = perWorker ? '' : ' [skipped: RL_INTEGRATION_WORKERS < 2]';
  run(`ROK-2206 worker DB identity (${carrier})${reason}`, () => {
    it('is connected to the clone named by its own JEST_WORKER_ID', async () => {
      const id = Number(process.env.JEST_WORKER_ID ?? 'NaN');
      const testApp = await getTestApp();
      const rows = await testApp.db.execute<{ db: string }>(
        sql`SELECT current_database() AS db`,
      );
      const db = at(rows, 0).db;

      expect({
        workerIdInRange: id >= 1 && id <= requestedWorkers(),
        dbCloneSuffix: db.slice(db.lastIndexOf('_w')),
        appUrlDb: databaseName(testApp.connectionString),
      }).toEqual({
        workerIdInRange: true,
        dbCloneSuffix: `_w${id}`,
        appUrlDb: db,
      });
    });
  });
}

/**
 * Failure-snapshot helper for the integration suite (ROK-1249, AC2).
 *
 * Writes a timestamped JSON snapshot under
 * planning-artifacts/test-infra-snapshots/ at the moment a
 * `socket hang up` / ECONNRESET surfaces, capturing five state
 * buckets defined in `snapshot-buckets.ts`. Returns the file path.
 *
 * Defensive: every bucket reader is wrapped in try/catch + 500ms
 * timeout so a bug here cannot amplify the very flake it diagnoses.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTestAppInstance } from './test-app';
import {
  readPostgresPool,
  readBullmqWorkers,
  readActiveHandles,
  readCronJobs,
  readRedisMockStore,
} from './snapshot-buckets';

const SNAPSHOT_DIR = path.resolve(
  __dirname,
  '../../../../planning-artifacts/test-infra-snapshots',
);

interface RequestContext {
  method: string;
  url: string;
  elapsedMs: number;
}

function buildSnapshotFilePath(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(SNAPSHOT_DIR, `snapshot-${iso}.json`);
}

export async function dumpFailureSnapshot(
  reason: string,
  context?: RequestContext,
): Promise<string> {
  const instance = getTestAppInstance();
  const [postgresPool, bullmqWorkers, activeHandles, cronJobs, redisMockStore] =
    await Promise.all([
      readPostgresPool(instance),
      readBullmqWorkers(instance),
      readActiveHandles(),
      readCronJobs(instance),
      readRedisMockStore(instance),
    ]);
  const snapshot = {
    capturedAt: new Date().toISOString(),
    reason,
    context: context ?? null,
    pid: process.pid,
    postgresPool,
    bullmqWorkers,
    activeHandles,
    cronJobs,
    redisMockStore,
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const filePath = buildSnapshotFilePath();
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}

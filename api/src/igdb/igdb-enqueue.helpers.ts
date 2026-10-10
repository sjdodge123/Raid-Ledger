/**
 * BullMQ enqueue helpers for IGDB sync jobs (ROK-986).
 * Extracted from IgdbService to stay within file size limits.
 */
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { games } from '../drizzle/schema';
import type { IgdbApiGame } from './igdb.constants';
import { REENRICH_DELAY_MS, type IgdbSyncJobData } from './igdb-sync.constants';
import { reEnrichGamesWithIgdb } from './igdb-reenrichment.helpers';

type Db = PostgresJsDatabase<typeof schema>;

type SyncQueue = Pick<Queue, 'add' | 'getJob'>;

/**
 * Clear a retained job under this fixed jobId so the next `add` schedules.
 * ROK-1741: BullMQ ignores an `add` whose jobId exists in ANY state, and
 * `removeOnComplete: 100` / `removeOnFail: 50` RETAIN finished jobs — one
 * retained `failed` scheduled sync silently wedged every later cron tick
 * (prod Redis persists across deploys). Mirrors ROK-1316 r3
 * (`pre-gen.queue.ts` `removeExisting`). Returns true when a sync is
 * `active` (locked mid-run) — the caller then skips rather than doubling it.
 */
async function clearRetainedJob(
  queue: SyncQueue,
  jobId: string,
): Promise<boolean> {
  const existing = await queue.getJob(jobId);
  if (!existing) return false;
  const state = await existing.getState();
  if (state === 'active') return true;
  await existing.remove();
  return false;
}

/** Enqueue an IGDB sync job (scheduled, config-update, or manual). */
export async function enqueueSyncJob(
  queue: SyncQueue,
  trigger: IgdbSyncJobData['trigger'],
): Promise<{ jobId: string }> {
  const jobId = `igdb-${trigger}-sync`;
  if (await clearRetainedJob(queue, jobId)) return { jobId };
  await queue.add(
    'sync',
    { trigger },
    { jobId, removeOnComplete: 100, removeOnFail: 50 },
  );
  return { jobId };
}

/** Enqueue a delayed re-enrichment job for a single game. */
export async function enqueueReenrichJob(
  queue: Queue,
  gameId: number,
): Promise<void> {
  await queue.add(
    'sync',
    { trigger: 'reenrich-game', gameId },
    {
      jobId: `reenrich-${gameId}`,
      delay: REENRICH_DELAY_MS,
      removeOnComplete: 100,
      removeOnFail: 50,
    },
  );
}

/**
 * Re-enrich a single game by ID. Sets status to 'pending'
 * then runs batch re-enrichment (which picks up that game).
 */
export async function reEnrichSingleGameById(
  db: Db,
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  gameId: number,
): Promise<void> {
  await db
    .update(games)
    .set({ igdbEnrichmentStatus: 'pending' })
    .where(eq(games.id, gameId));
  await reEnrichGamesWithIgdb(db, queryIgdb);
}

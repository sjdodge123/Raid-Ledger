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

/** Enqueue an IGDB sync job (scheduled, config-update, or manual). */
export async function enqueueSyncJob(
  queue: Queue,
  trigger: IgdbSyncJobData['trigger'],
): Promise<{ jobId: string }> {
  const jobId = `igdb-${trigger}-sync`;
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
    { trigger: 'reenrich-game', gameId } as IgdbSyncJobData,
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

/**
 * Enqueue helpers for the ITAD price-sync queue (ROK-1047).
 * BullMQ rejects duplicate jobIds while waiting/active, so per-game
 * dedupe is intrinsic — enqueueing the same gameId twice during the
 * same fetch window is a no-op. Same trick as
 * `igdb-enqueue.helpers.ts:enqueueReenrichJob`.
 */
import type { Queue } from 'bullmq';
import type { ItadPriceSyncJobData } from './itad-price-sync.constants';

export function buildPriceSyncJobId(gameId: number): string {
  return `itad-price-${gameId}`;
}

/** Fire-and-forget enqueue for a single game. Logs but never throws. */
export async function enqueuePriceSync(
  queue: Queue,
  gameId: number,
): Promise<void> {
  const data: ItadPriceSyncJobData = { gameId };
  await queue.add('sync', data, {
    jobId: buildPriceSyncJobId(gameId),
    removeOnComplete: 100,
    removeOnFail: 50,
  });
}

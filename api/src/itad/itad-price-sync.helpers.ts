/**
 * Helpers for the ITAD price sync: the pricing-phase chunk runner and the
 * enqueue helpers for the ITAD price-sync queue (ROK-1047).
 *
 * Enqueue helpers:
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

/** Pricing-phase totals; `failed` counts chunks that failed twice. */
export interface PricingPhaseResult {
  succeeded: number;
  failed: number;
  retried: number;
}

/**
 * Run every pricing chunk, then retry the chunks that failed once more at the
 * end of the phase. By then an ITAD 429 pause has usually expired, so a chunk
 * that exhausted its retries during a burst gets a second chance this run
 * instead of 4 hours later. Only chunks that fail both times count as failed.
 */
export async function processPricingChunks<T>(
  chunks: T[],
  processChunk: (chunk: T) => Promise<boolean>,
): Promise<PricingPhaseResult> {
  const retry: T[] = [];
  let succeeded = 0;
  for (const chunk of chunks) {
    if (await processChunk(chunk)) succeeded++;
    else retry.push(chunk);
  }
  let failed = 0;
  for (const chunk of retry) {
    if (await processChunk(chunk)) succeeded++;
    else failed++;
  }
  return { succeeded, failed, retried: retry.length };
}

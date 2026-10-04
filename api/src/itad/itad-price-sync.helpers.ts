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

/**
 * Outcome of one pricing chunk. `exhausted` means the overview fetch returned
 * no data (ItadOverviewFetchError: retries exhausted, or a non-retriable HTTP
 * error such as a 401); `failed` is any other error (e.g. the DB update).
 */
export type PricingChunkOutcome = 'ok' | 'failed' | 'exhausted';

/** Consecutive `exhausted` chunks that stop the pricing phase early. */
export const PRICING_BREAKER_THRESHOLD = 3;

/**
 * Pricing-phase totals; `failed` counts chunks that failed twice plus, when
 * the breaker tripped, every chunk it skipped. `tripped` is true when the
 * phase stopped early on consecutive exhausted overview fetches.
 */
export interface PricingPhaseResult {
  succeeded: number;
  failed: number;
  retried: number;
  tripped: boolean;
}

type ChunkFn<T> = (chunk: T) => Promise<PricingChunkOutcome>;

/** Running count of consecutive `exhausted` outcomes, shared by both passes. */
interface ExhaustionStreak {
  count: number;
}

/** Record one outcome; true once the streak reaches the breaker threshold. */
function recordOutcome(
  streak: ExhaustionStreak,
  outcome: PricingChunkOutcome,
): boolean {
  if (outcome === 'ok') streak.count = 0;
  else if (outcome === 'exhausted') streak.count++;
  return streak.count >= PRICING_BREAKER_THRESHOLD;
}

/** One pass over `chunks`; `pending` holds every chunk that did not succeed. */
async function runPass<T>(
  chunks: T[],
  processChunk: ChunkFn<T>,
  streak: ExhaustionStreak,
): Promise<{ succeeded: number; pending: T[]; tripped: boolean }> {
  const pending: T[] = [];
  let succeeded = 0;
  for (const [i, chunk] of chunks.entries()) {
    const outcome = await processChunk(chunk);
    if (outcome === 'ok') succeeded++;
    else pending.push(chunk);
    if (recordOutcome(streak, outcome)) {
      pending.push(...chunks.slice(i + 1));
      return { succeeded, pending, tripped: true };
    }
  }
  return { succeeded, pending, tripped: false };
}

/**
 * Run every pricing chunk, then retry the chunks that failed once more at the
 * end of the phase. By then an ITAD 429 pause has usually expired, so a chunk
 * that exhausted its retries during a burst gets a second chance this run
 * instead of 4 hours later. Only chunks that fail both times count as failed.
 *
 * Breaker: after PRICING_BREAKER_THRESHOLD consecutive `exhausted` chunks
 * (the streak carries into the retry pass; an `ok` resets it, a generic
 * `failed` leaves it as is) the phase stops. Every chunk not yet succeeded
 * counts as failed, and a trip in the first pass skips the retry pass.
 */
export async function processPricingChunks<T>(
  chunks: T[],
  processChunk: ChunkFn<T>,
): Promise<PricingPhaseResult> {
  const streak: ExhaustionStreak = { count: 0 };
  const first = await runPass(chunks, processChunk, streak);
  if (first.tripped) {
    const failed = first.pending.length;
    return { succeeded: first.succeeded, failed, retried: 0, tripped: true };
  }
  const second = await runPass(first.pending, processChunk, streak);
  return {
    succeeded: first.succeeded + second.succeeded,
    failed: second.pending.length,
    retried: first.pending.length,
    tripped: second.tripped,
  };
}

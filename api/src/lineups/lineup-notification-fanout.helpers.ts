/**
 * Shared batched DM fan-out primitive (ROK-1101 TD-3).
 *
 * Unifies the lineup notification fan-out helpers with the pattern
 * `LineupSteamNudgeService.nudgeUnlinkedMembers` already used: slice the
 * recipient list into fixed-size batches and dispatch each batch with
 * `Promise.allSettled`.
 *
 * Two properties matter, and both were missing from the previous
 * `for (const member of members) await send(member)` loops:
 *
 * 1. **Isolation.** A single undeliverable DM (Discord 50007 "cannot send
 *    messages to this user", a closed DM channel, a transient 5xx) used to
 *    reject out of the loop and silently drop every *later* recipient.
 *    `allSettled` contains the failure to its own recipient.
 * 2. **Throughput.** Batches of {@link DM_FANOUT_BATCH_SIZE} overlap the
 *    round-trips instead of serialising them, while still bounding
 *    concurrency so a large community cannot burst past Discord rate limits.
 *
 * Rejections are not swallowed silently — each one is logged with its
 * recipient index so a systemic failure is still visible in the API logs.
 */
import { Logger } from '@nestjs/common';

/** Recipients dispatched concurrently per batch (nudge-service parity). */
export const DM_FANOUT_BATCH_SIZE = 10;

const logger = new Logger('LineupDmFanOut');

/**
 * Dispatch `send` across `items` in batches, isolating per-item failures.
 *
 * @param items - recipients (or any per-DM payload) to fan out over
 * @param send - per-item dispatcher; may reject without aborting the fan-out
 * @param context - short label used when logging a rejected dispatch
 */
export async function fanOutInBatches<T>(
  items: ReadonlyArray<T>,
  send: (item: T) => Promise<unknown>,
  context: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += DM_FANOUT_BATCH_SIZE) {
    const batch = items.slice(i, i + DM_FANOUT_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((item) => send(item)));
    logRejections(results, context, i);
  }
}

/** Log any rejected dispatch in a settled batch (one line per failure). */
function logRejections(
  results: ReadonlyArray<PromiseSettledResult<unknown>>,
  context: string,
  offset: number,
): void {
  results.forEach((result, idx) => {
    if (result.status !== 'rejected') return;
    logger.warn(
      `${context}: DM dispatch failed for recipient #${offset + idx}: ${
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      }`,
    );
  });
}

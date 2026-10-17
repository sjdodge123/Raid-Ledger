/**
 * BullMQ queue + job metadata for game-taste-vector event-driven recomputes
 * (ROK-1082). Consumers enqueue with `{ jobId: \`game-taste-recompute-${gameId}\` }`
 * so repeated writes for the same game dedupe on the queue.
 */
export const GAME_TASTE_RECOMPUTE_QUEUE = 'game-taste-recompute';

export interface GameTasteRecomputeJobData {
  gameId: number;
}

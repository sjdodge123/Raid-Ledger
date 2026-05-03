/**
 * BullMQ queue + job constants for ITAD price sync (ROK-1047).
 * The price-sync queue is used for fire-and-forget per-game ITAD lookups
 * triggered by `/games/pricing/batch` cache misses.
 */

export const ITAD_PRICE_SYNC_QUEUE = 'itad-price-sync';

/** Stale window: re-enqueue a fetch if cached pricing is older than 4h. */
export const PRICING_STALE_MS = 4 * 60 * 60 * 1000;

export interface ItadPriceSyncJobData {
  gameId: number;
}

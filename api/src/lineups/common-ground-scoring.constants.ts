/**
 * Scoring constants for the Common Ground query (ROK-934).
 * Weights are exposed in the API response for observability.
 */

/** Points per library owner. */
export const OWNER_WEIGHT = 10;

/** Bonus points when the game is currently on sale. */
export const SALE_BONUS = 5;

/** Penalty when the game is at full price. */
export const FULL_PRICE_PENALTY = 2;

/** Default minimum owners filter. */
export const DEFAULT_MIN_OWNERS = 2;

/** Maximum results returned per query. */
export const MAX_RESULTS = 50;

/** Base nomination cap (floor). */
export const BASE_NOMINATION_CAP = 20;

/** Extra nomination slots per unique participant. */
export const NOMINATIONS_PER_PARTICIPANT = 5;

/** Dynamic cap: max(20, participants * 5). */
export function nominationCap(participantCount: number): number {
  return Math.max(
    BASE_NOMINATION_CAP,
    participantCount * NOMINATIONS_PER_PARTICIPANT,
  );
}

/**
 * @deprecated Use nominationCap() for dynamic cap.
 * Kept for backward-compat in common-ground meta response.
 */
export const MAX_LINEUP_ENTRIES = BASE_NOMINATION_CAP;

/** Pre-built weights object for API response metadata. */
export const SCORING_WEIGHTS = {
  ownerWeight: OWNER_WEIGHT,
  saleBonus: SALE_BONUS,
  fullPricePenalty: FULL_PRICE_PENALTY,
} as const;

/**
 * ITAD (IsThereAnyDeal) constants and type definitions (ROK-772).
 */

export const ITAD_BASE_URL = 'https://api.isthereanydeal.com';
// ─── Rate Limit / Cache ──────────────────────────────────────
/** Minimum delay between sequential ITAD API calls (ms) */
export const ITAD_RATE_LIMIT_MS = 150;
/** Redis cache TTL for lookup results (24h) */
export const ITAD_LOOKUP_CACHE_TTL = 86_400;
/** Redis cache TTL for search results (1h) */
export const ITAD_SEARCH_CACHE_TTL = 3_600;
/** Redis cache TTL for info results (24h) */
export const ITAD_INFO_CACHE_TTL = 86_400;
/** Max retries on HTTP 429 before giving up */
export const ITAD_MAX_RETRIES = 3;
/** Initial backoff delay on 429 (ms) — doubles each retry */
export const ITAD_BACKOFF_INITIAL_MS = 500;
/**
 * Ceiling on a server-supplied `Retry-After` wait (ms). A 429 pauses every
 * ITAD caller for this long at most, so a hostile or buggy header cannot
 * stall the syncs indefinitely.
 */
export const ITAD_RETRY_AFTER_MAX_MS = 60_000;
/**
 * Fetch options for user-facing ITAD calls (search, detail pricing, Steam-id
 * lookup). They give up (resolve null) rather than wait out a 429 pause
 * longer than this, so an HTTP request is not held open for up to
 * `ITAD_RETRY_AFTER_MAX_MS` per attempt. A short `Retry-After` still retries.
 */
export const ITAD_INTERACTIVE_FETCH = { maxPauseWaitMs: 5_000 } as const;

/** Redis cache TTL for price/overview results (3h) */
export const ITAD_PRICE_CACHE_TTL = 10_800;

// ─── Redis key prefixes ──────────────────────────────────────
export const ITAD_CACHE_PREFIX = 'itad:';
export const ITAD_LOOKUP_PREFIX = `${ITAD_CACHE_PREFIX}lookup:`;
export const ITAD_SEARCH_PREFIX = `${ITAD_CACHE_PREFIX}search:`;
export const ITAD_INFO_PREFIX = `${ITAD_CACHE_PREFIX}info:`;
export const ITAD_PRICE_PREFIX = `${ITAD_CACHE_PREFIX}price:`;

// ─── API response types ──────────────────────────────────────

export interface ItadAssets {
  boxart?: string;
  banner145?: string;
  banner300?: string;
  banner400?: string;
  banner600?: string;
}

export interface ItadGame {
  id: string;
  slug: string;
  title: string;
  type: string;
  mature: boolean;
  assets?: ItadAssets;
}

export interface ItadLookupResponse {
  found: boolean;
  game?: ItadGame;
}

export interface ItadReview {
  score: number;
  source: string;
  count: number;
  url: string;
}

/** Steam shop ID for ITAD shop lookups */
export const ITAD_STEAM_SHOP_ID = 61;

/**
 * Response from POST /lookup/shop/{shopId}/id/v1.
 * Maps ITAD slug paths to shop-specific IDs (e.g., Steam appids).
 */
export type ItadShopLookupResponse = Record<string, string | null>;

export interface ItadGameInfo {
  id: string;
  slug: string;
  title: string;
  type: string;
  mature: boolean;
  assets?: ItadAssets;
  tags?: string[];
  releaseDate?: string;
  developers?: string[];
  publishers?: string[];
  reviews?: ItadReview[];
  stats?: Record<string, unknown>;
  players?: Record<string, unknown>;
  achievements?: { total: number; count?: number };
  earlyAccess?: boolean;
}

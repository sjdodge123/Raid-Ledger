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

// ─── Redis key prefixes ──────────────────────────────────────
export const ITAD_CACHE_PREFIX = 'itad:';
export const ITAD_LOOKUP_PREFIX = `${ITAD_CACHE_PREFIX}lookup:`;
export const ITAD_SEARCH_PREFIX = `${ITAD_CACHE_PREFIX}search:`;
export const ITAD_INFO_PREFIX = `${ITAD_CACHE_PREFIX}info:`;

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

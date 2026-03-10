import { GameDetailDto } from '@raid-ledger/contract';

/** IGDB Theme IDs for adult content filtering */
export const ADULT_THEME_IDS = [42, 39]; // 42 = Erotic, 39 = Sexual Content

/**
 * Keyword blocklist for adult content that IGDB may not tag with adult themes.
 * When the adult filter is enabled, games whose names contain any of these
 * keywords (case-insensitive) are excluded from search results.
 */
export const ADULT_KEYWORDS = [
  'hentai',
  'porn',
  'xxx',
  'nsfw',
  'erotic',
  'lewd',
  'nude',
  'naked',
  'sex toy',
  'harem',
  'ecchi',
  'futanari',
  'waifu',
  'ahegao',
  'succubus',
  'brothel',
  'stripclub',
  'strip poker',
];

/** IGDB API game response structure (expanded for ROK-229) */
export interface IgdbApiGame {
  id: number;
  name: string;
  slug: string;
  cover?: {
    image_id: string;
  };
  genres?: { id: number }[];
  themes?: { id: number }[];
  game_modes?: number[];
  platforms?: { id: number }[];
  summary?: string;
  rating?: number;
  aggregated_rating?: number;
  total_rating?: number;
  screenshots?: { image_id: string }[];
  videos?: { name: string; video_id: string }[];
  first_release_date?: number;
  multiplayer_modes?: {
    onlinemax?: number;
    offlinemax?: number;
    onlinecoop?: boolean;
    offlinecoop?: boolean;
    lancoop?: boolean;
    splitscreen?: boolean;
    platform?: number;
  }[];
  external_games?: { category?: number; external_game_source?: number; uid: string }[];
}

/** Search result with source tracking */
export interface SearchResult {
  games: GameDetailDto[];
  cached: boolean;
  source: 'redis' | 'database' | 'igdb' | 'local';
}

/** Constants for IGDB integration */
export const IGDB_CONFIG = {
  /** Buffer time before token expiry (seconds) */
  TOKEN_EXPIRY_BUFFER: 300,
  /** Maximum games to return per search */
  SEARCH_LIMIT: 20,
  /** IGDB cover image base URL */
  COVER_URL_BASE: 'https://images.igdb.com/igdb/image/upload/t_cover_big',
  /** IGDB screenshot image base URL */
  SCREENSHOT_URL_BASE:
    'https://images.igdb.com/igdb/image/upload/t_screenshot_big',
  /** Redis cache TTL for search results (24 hours) */
  SEARCH_CACHE_TTL: 86400,
  /** Redis cache TTL for discovery rows (1 hour) */
  DISCOVER_CACHE_TTL: 3600,
  /** Redis cache TTL for streams (5 minutes) */
  STREAMS_CACHE_TTL: 300,
  /** Maximum retry attempts for 429 errors */
  MAX_RETRIES: 3,
  /** Base delay for exponential backoff (ms) */
  BASE_RETRY_DELAY: 1000,
  /** Steam external game category ID in IGDB */
  STEAM_CATEGORY_ID: 1,
  /** Twitch external game category ID in IGDB */
  TWITCH_CATEGORY_ID: 14,
  /** Expanded APICALYPSE fields for discovery */
  EXPANDED_FIELDS: [
    'name',
    'slug',
    'cover.image_id',
    'genres.id',
    'themes.id',
    'game_modes',
    'platforms.id',
    'summary',
    'rating',
    'aggregated_rating',
    'total_rating',
    'screenshots.image_id',
    'videos.name',
    'videos.video_id',
    'first_release_date',
    'multiplayer_modes.*',
    'external_games.*',
  ].join(', '),
} as const;

/**
 * ROK-587: IGDB slugs that are variant-specific WoW Classic entries.
 * These should be auto-hidden during IGDB sync to prevent duplicate
 * game entries -- all WoW Classic variants use the single
 * "world-of-warcraft-classic" game entry and the gameVariant field
 * on characters to distinguish between Classic Era, TBC Anniversary, etc.
 */
export const WOW_CLASSIC_VARIANT_SLUGS = new Set([
  'world-of-warcraft-classic-the-burning-crusade',
  'world-of-warcraft-classic-anniversary',
  'world-of-warcraft-classic-burning-crusade-classic',
]);

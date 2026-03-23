/**
 * ITAD + IGDB data merge helpers (ROK-773).
 * Merges ITAD search results with IGDB enrichment data
 * into GameDetailDto-compatible objects for upsert.
 */
import type { GameDetailDto } from '@raid-ledger/contract';

/** ITAD search result with optional enrichment fields. */
export interface ItadSearchGame {
  id: string;
  slug: string;
  title: string;
  type: string;
  mature: boolean;
  assets?: { boxart?: string };
  tags?: string[];
  releaseDate?: string;
  steamAppId?: number;
}

/** IGDB data obtained via external_games exact match. */
export interface IgdbEnrichedData {
  igdbId: number;
  coverUrl: string | null;
  summary: string | null;
  genres: number[];
  themes: number[];
  gameModes: number[];
  platforms: number[];
  screenshots: string[];
  videos: { name?: string; videoId: string }[];
  twitchGameId: string | null;
  playerCount: { min: number; max: number } | null;
  crossplay: boolean | null;
  rating: number | null;
  aggregatedRating: number | null;
}

/**
 * Merge ITAD game data with IGDB enrichment.
 * Uses IGDB cover when available, falls back to ITAD boxart.
 * @param itad - ITAD search result
 * @param igdb - IGDB enrichment data from external_games match
 * @returns Partial GameDetailDto for upsert
 */
export function mergeItadWithIgdb(
  itad: ItadSearchGame,
  igdb: IgdbEnrichedData,
): GameDetailDto {
  const boxart = itad.assets?.boxart ?? null;
  return {
    ...buildItadBaseFields(itad, boxart),
    igdbId: igdb.igdbId,
    coverUrl: igdb.coverUrl ?? boxart,
    genres: igdb.genres,
    summary: igdb.summary,
    rating: igdb.rating,
    aggregatedRating: igdb.aggregatedRating,
    gameModes: igdb.gameModes,
    themes: igdb.themes,
    platforms: igdb.platforms,
    screenshots: igdb.screenshots,
    videos: igdb.videos,
    playerCount: igdb.playerCount,
    twitchGameId: igdb.twitchGameId,
    crossplay: igdb.crossplay,
  };
}

/** Build the common ITAD base fields shared by merge and ITAD-only paths. */
function buildItadBaseFields(itad: ItadSearchGame, boxart: string | null) {
  return {
    id: 0,
    name: itad.title,
    slug: itad.slug,
    itadBoxartUrl: boxart,
    itadGameId: itad.id,
    itadTags: itad.tags ?? [],
    earlyAccess: false,
    firstReleaseDate: parseReleaseDate(itad.releaseDate),
    popularity: null,
  };
}

/**
 * Build a GameDetailDto from ITAD data only (no IGDB match).
 * @param itad - ITAD search result
 * @returns GameDetailDto with ITAD-only data
 */
export function buildItadOnlyDetail(itad: ItadSearchGame): GameDetailDto {
  const boxart = itad.assets?.boxart ?? null;
  return {
    ...buildItadBaseFields(itad, boxart),
    igdbId: null,
    coverUrl: boxart,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
  };
}

/** Parse ITAD date string to ISO string, or null. */
function parseReleaseDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

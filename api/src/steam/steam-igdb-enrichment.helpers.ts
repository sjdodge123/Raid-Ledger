/**
 * IGDB enrichment helpers for Steam library sync (ROK-774).
 * Queries IGDB by Steam app ID for exact match enrichment.
 */
import { Logger } from '@nestjs/common';
import { IGDB_CONFIG, type IgdbApiGame } from '../igdb/igdb.constants';

const logger = new Logger('SteamIgdbEnrichment');

/** Fields returned from IGDB enrichment relevant to game updates. */
export interface IgdbEnrichmentData {
  igdbId: number;
  name: string;
  slug: string;
  coverUrl: string | null;
  summary: string | null;
  rating: number | null;
  aggregatedRating: number | null;
  genres: number[];
  themes: number[];
  gameModes: number[];
  platforms: number[];
  screenshots: string[];
  videos: { name: string; videoId: string }[];
  firstReleaseDate: Date | null;
  steamAppId: number;
}

/** Build the IGDB query for a single Steam app ID lookup. */
export function buildSteamLookupQuery(steamAppId: number): string {
  return (
    `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; ` +
    `where external_games.category = ${IGDB_CONFIG.STEAM_CATEGORY_ID} ` +
    `& external_games.uid = "${steamAppId}"; ` +
    `limit 1;`
  );
}

/** Map IGDB screenshot image_ids to full URLs. */
function mapScreenshots(game: IgdbApiGame): string[] {
  return (
    game.screenshots?.map(
      (s) => `${IGDB_CONFIG.SCREENSHOT_URL_BASE}/${s.image_id}.jpg`,
    ) ?? []
  );
}

/** Map IGDB videos to our video format. */
function mapVideos(game: IgdbApiGame) {
  return game.videos?.map((v) => ({ name: v.name, videoId: v.video_id })) ?? [];
}

/** Map an IGDB API game response to enrichment data. */
export function mapIgdbToEnrichment(
  game: IgdbApiGame,
  steamAppId: number,
): IgdbEnrichmentData {
  return {
    igdbId: game.id,
    name: game.name,
    slug: game.slug,
    coverUrl: game.cover
      ? `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`
      : null,
    summary: game.summary ?? null,
    rating: game.rating ?? null,
    aggregatedRating: game.aggregated_rating ?? null,
    genres: game.genres?.map((g) => g.id) ?? [],
    themes: game.themes?.map((t) => t.id) ?? [],
    gameModes: game.game_modes ?? [],
    platforms: game.platforms?.map((p) => p.id) ?? [],
    screenshots: mapScreenshots(game),
    videos: mapVideos(game),
    firstReleaseDate: game.first_release_date
      ? new Date(game.first_release_date * 1000)
      : null,
    steamAppId,
  };
}

/**
 * Query IGDB for a game by Steam app ID.
 * Returns enrichment data if found, null otherwise.
 */
export async function enrichFromIgdb(
  steamAppId: number,
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
): Promise<IgdbEnrichmentData | null> {
  try {
    const query = buildSteamLookupQuery(steamAppId);
    const games = await queryIgdb(query);
    if (games.length === 0) return null;
    return mapIgdbToEnrichment(games[0], steamAppId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`IGDB enrichment failed for Steam app ${steamAppId}: ${msg}`);
    return null;
  }
}

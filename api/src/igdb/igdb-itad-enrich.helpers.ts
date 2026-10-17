/**
 * IGDB enrichment via external_games exact match (ROK-773).
 * Queries IGDB using Steam app IDs (category=1) for exact matching
 * instead of error-prone title search.
 */
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';
import type { IgdbEnrichedData } from './igdb-itad-merge.helpers';

/**
 * Build APICALYPSE query for exact external_games match.
 * @param steamAppId - Steam application ID
 * @returns APICALYPSE query string
 */
export function buildExternalGamesQuery(steamAppId: number): string {
  return [
    `fields ${IGDB_CONFIG.EXPANDED_FIELDS};`,
    `where external_games.category = ${IGDB_CONFIG.STEAM_CATEGORY_ID}`,
    `& external_games.uid = "${steamAppId}";`,
    'limit 1;',
  ].join(' ');
}

/**
 * Parse IGDB API game response into enrichment data.
 * @param game - Raw IGDB API game object
 * @returns Enrichment data or null
 */
export function parseIgdbEnrichment(
  game: Partial<IgdbApiGame> & { id: number },
): IgdbEnrichedData {
  const coverUrl = game.cover
    ? `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`
    : null;

  const twitchExt = game.external_games?.find(
    (eg) =>
      eg.category === IGDB_CONFIG.TWITCH_CATEGORY_ID ||
      eg.external_game_source === IGDB_CONFIG.TWITCH_CATEGORY_ID,
  );

  return {
    igdbId: game.id,
    coverUrl,
    summary: game.summary ?? null,
    genres: game.genres?.map((g) => g.id) ?? [],
    themes: game.themes?.map((t) => t.id) ?? [],
    gameModes: game.game_modes ?? [],
    platforms: game.platforms?.map((p) => p.id) ?? [],
    screenshots: buildScreenshots(game),
    videos: buildVideos(game),
    twitchGameId: twitchExt?.uid ?? null,
    playerCount: extractPlayerCount(game),
    crossplay: null,
    rating: game.rating ?? null,
    aggregatedRating: game.aggregated_rating ?? null,
  };
}

/** Build screenshot URLs from IGDB data. */
function buildScreenshots(game: Partial<IgdbApiGame>): string[] {
  return (
    game.screenshots?.map(
      (s) => `${IGDB_CONFIG.SCREENSHOT_URL_BASE}/${s.image_id}.jpg`,
    ) ?? []
  );
}

/** Build video objects from IGDB data. */
function buildVideos(
  game: Partial<IgdbApiGame>,
): { name?: string; videoId: string }[] {
  return (
    game.videos?.map((v) => ({
      name: v.name,
      videoId: v.video_id,
    })) ?? []
  );
}

/** Extract player count from multiplayer modes. */
function extractPlayerCount(
  game: Partial<IgdbApiGame>,
): { min: number; max: number } | null {
  if (!game.multiplayer_modes?.length) return null;
  const maxPlayers = Math.max(
    ...game.multiplayer_modes.map((m) =>
      Math.max(m.onlinemax ?? 0, m.offlinemax ?? 0),
    ),
  );
  return maxPlayers > 0 ? { min: 1, max: maxPlayers } : null;
}

import { GameDetailDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';

/** Match external_games category via `category` or `external_game_source` (IGDB API field rename). */
function matchExternalCategory(
  eg: NonNullable<IgdbApiGame['external_games']>[number],
  categoryId: number,
): boolean {
  return eg.category === categoryId || eg.external_game_source === categoryId;
}

/** Extract Twitch category ID from external_games. */
function extractTwitchGameId(game: IgdbApiGame): string | null {
  const ext = game.external_games?.find((eg) =>
    matchExternalCategory(eg, IGDB_CONFIG.TWITCH_CATEGORY_ID),
  );
  return ext?.uid ?? null;
}

/** Extract Steam AppID from external_games (ROK-417). */
function extractSteamAppId(game: IgdbApiGame): number | null {
  const ext = game.external_games?.find((eg) =>
    matchExternalCategory(eg, IGDB_CONFIG.STEAM_CATEGORY_ID),
  );
  const id = ext?.uid ? parseInt(ext.uid, 10) : null;
  return id && !isNaN(id) ? id : null;
}

/**
 * Extract player count and crossplay info from multiplayer modes.
 * @param game - IGDB API game object
 * @returns playerCount and crossplay values
 */
function extractMultiplayerInfo(game: IgdbApiGame): {
  playerCount: { min: number; max: number } | null;
  crossplay: boolean | null;
} {
  if (!game.multiplayer_modes || game.multiplayer_modes.length === 0) {
    return { playerCount: null, crossplay: null };
  }

  const maxPlayers = Math.max(
    ...game.multiplayer_modes.map((m) =>
      Math.max(m.onlinemax ?? 0, m.offlinemax ?? 0),
    ),
  );
  const playerCount = maxPlayers > 0 ? { min: 1, max: maxPlayers } : null;

  const platformsWithOnline = new Set(
    game.multiplayer_modes
      .filter((m) => (m.onlinemax ?? 0) > 0 && m.platform)
      .map((m) => m.platform),
  );
  const crossplay = platformsWithOnline.size >= 2 ? true : null;

  return { playerCount, crossplay };
}

/** Build media arrays (screenshots, videos) from API game data. */
function buildMediaFields(game: IgdbApiGame) {
  return {
    screenshots:
      game.screenshots?.map(
        (s) => `${IGDB_CONFIG.SCREENSHOT_URL_BASE}/${s.image_id}.jpg`,
      ) ?? [],
    videos:
      game.videos?.map((v) => ({
        name: v.name,
        videoId: v.video_id,
      })) ?? [],
  };
}

/**
 * Map an IGDB API game response to a database insert row.
 * @param game - Raw IGDB API game object
 * @returns Database-ready row object
 */
export function mapApiGameToDbRow(game: IgdbApiGame) {
  const { playerCount, crossplay } = extractMultiplayerInfo(game);
  const media = buildMediaFields(game);

  return {
    igdbId: game.id,
    name: game.name,
    slug: game.slug,
    coverUrl: game.cover
      ? `${IGDB_CONFIG.COVER_URL_BASE}/${game.cover.image_id}.jpg`
      : null,
    genres: game.genres?.map((g) => g.id) ?? [],
    summary: game.summary ?? null,
    rating: game.rating ?? null,
    aggregatedRating: game.aggregated_rating ?? null,
    popularity: game.total_rating ?? null,
    gameModes: game.game_modes ?? [],
    themes: game.themes?.map((t) => t.id) ?? [],
    platforms: game.platforms?.map((p) => p.id) ?? [],
    ...media,
    firstReleaseDate: game.first_release_date
      ? new Date(game.first_release_date * 1000)
      : null,
    playerCount,
    twitchGameId: extractTwitchGameId(game),
    crossplay,
    steamAppId: extractSteamAppId(game),
  };
}

/** Extract ITAD pricing fields from a DB row (ROK-818). */
function mapItadPricing(g: typeof schema.games.$inferSelect) {
  return {
    itadGameId: g.itadGameId ?? null,
    itadBoxartUrl: g.itadBoxartUrl ?? null,
    itadTags: (g.itadTags as string[]) ?? [],
    itadCurrentPrice:
      g.itadCurrentPrice != null ? Number(g.itadCurrentPrice) : null,
    itadCurrentCut: g.itadCurrentCut ?? null,
    itadCurrentShop: g.itadCurrentShop ?? null,
    itadCurrentUrl: g.itadCurrentUrl ?? null,
    itadLowestPrice:
      g.itadLowestPrice != null ? Number(g.itadLowestPrice) : null,
    itadLowestCut: g.itadLowestCut ?? null,
    itadPriceUpdatedAt: g.itadPriceUpdatedAt?.toISOString() ?? null,
  };
}

/**
 * Map a database game row to a GameDetailDto.
 * @param g - Database game row
 * @returns GameDetailDto for API response
 */
export function mapDbRowToDetail(
  g: typeof schema.games.$inferSelect,
): GameDetailDto {
  return {
    id: g.id,
    igdbId: g.igdbId,
    name: g.name,
    slug: g.slug,
    coverUrl: g.coverUrl,
    genres: (g.genres as number[]) ?? [],
    summary: g.summary,
    rating: g.rating,
    aggregatedRating: g.aggregatedRating,
    popularity: g.popularity,
    gameModes: (g.gameModes as number[]) ?? [],
    themes: (g.themes as number[]) ?? [],
    platforms: (g.platforms as number[]) ?? [],
    screenshots: (g.screenshots as string[]) ?? [],
    videos: (g.videos as { name: string; videoId: string }[]) ?? [],
    firstReleaseDate: g.firstReleaseDate
      ? g.firstReleaseDate.toISOString()
      : null,
    playerCount: g.playerCount as { min: number; max: number } | null,
    twitchGameId: g.twitchGameId,
    crossplay: g.crossplay ?? null,
    ...mapItadPricing(g),
  };
}

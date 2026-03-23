/**
 * ITAD game upsert helpers (ROK-773).
 * Persists ITAD search results to the games table using slug
 * as the conflict target (since ITAD games may lack igdbId).
 */
import { sql, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDetailDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { mapDbRowToDetail } from './igdb.mappers';

/**
 * Upsert a single ITAD game to the database.
 * Uses slug as the conflict target since ITAD games may not have igdbId.
 * Returns the persisted row with a real DB id.
 */
export async function upsertItadGame(
  db: PostgresJsDatabase<typeof schema>,
  game: GameDetailDto,
): Promise<GameDetailDto> {
  const values = buildItadInsertValues(game);

  await db
    .insert(schema.games)
    .values(values)
    .onConflictDoUpdate({
      target: schema.games.slug,
      set: buildItadUpdateSet(game),
    });

  return fetchBySlug(db, game.slug);
}

/** Build insert values from a GameDetailDto. */
function buildItadInsertValues(game: GameDetailDto) {
  return {
    igdbId: game.igdbId,
    name: game.name,
    slug: game.slug,
    coverUrl: game.coverUrl,
    genres: game.genres,
    summary: game.summary,
    rating: game.rating,
    aggregatedRating: game.aggregatedRating,
    popularity: game.popularity,
    gameModes: game.gameModes,
    themes: game.themes,
    platforms: game.platforms,
    screenshots: game.screenshots,
    videos: game.videos.map((v) => ({
      name: v.name ?? '',
      videoId: v.videoId,
    })),
    firstReleaseDate: game.firstReleaseDate
      ? new Date(game.firstReleaseDate)
      : null,
    playerCount: game.playerCount,
    twitchGameId: game.twitchGameId,
    crossplay: game.crossplay,
    itadGameId: game.itadGameId,
    itadBoxartUrl: game.itadBoxartUrl,
    itadTags: game.itadTags,
    earlyAccess: game.earlyAccess ?? false,
  };
}

/** Build the update set for ITAD game upsert. */
function buildItadUpdateSet(game: GameDetailDto) {
  return {
    name: game.name,
    coverUrl: game.coverUrl,
    genres: game.genres,
    summary: game.summary,
    rating: game.rating,
    aggregatedRating: game.aggregatedRating,
    gameModes: game.gameModes,
    themes: game.themes,
    platforms: game.platforms,
    screenshots: game.screenshots,
    videos: game.videos.map((v) => ({
      name: v.name ?? '',
      videoId: v.videoId,
    })),
    firstReleaseDate: game.firstReleaseDate
      ? new Date(game.firstReleaseDate)
      : null,
    playerCount: game.playerCount,
    twitchGameId: game.twitchGameId ?? sql`${schema.games.twitchGameId}`,
    crossplay: game.crossplay,
    igdbId: game.igdbId ?? sql`${schema.games.igdbId}`,
    itadGameId: game.itadGameId,
    itadBoxartUrl: game.itadBoxartUrl,
    itadTags: game.itadTags,
    earlyAccess: game.earlyAccess ?? sql`${schema.games.earlyAccess}`,
    cachedAt: new Date(),
  };
}

/** Fetch a game by slug and return as GameDetailDto. */
async function fetchBySlug(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
): Promise<GameDetailDto> {
  const rows = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  return mapDbRowToDetail(rows[0]);
}

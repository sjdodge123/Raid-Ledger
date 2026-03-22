import { Logger } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import {
  IGDB_CONFIG,
  ADULT_THEME_IDS,
  type IgdbApiGame,
} from './igdb.constants';
import { delay } from './igdb-api.helpers';
import { upsertGamesFromApi } from './igdb-upsert.helpers';
import type { ItadGame, ItadGameInfo } from '../itad/itad.constants';

const logger = new Logger('IgdbSyncHelpers');

/**
 * Refresh existing non-hidden, non-banned games from IGDB in batches.
 * @param db - Database connection
 * @param queryIgdb - Function to execute IGDB queries
 * @param adultThemeFilter - APICALYPSE adult theme filter string
 * @returns Number of games refreshed
 */
export async function refreshExistingGames(
  db: PostgresJsDatabase<typeof schema>,
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  adultThemeFilter: string,
): Promise<number> {
  let refreshed = 0;
  const games = await db
    .select({ igdbId: schema.games.igdbId })
    .from(schema.games)
    .where(and(eq(schema.games.hidden, false), eq(schema.games.banned, false)));

  if (games.length === 0) return 0;

  for (let i = 0; i < games.length; i += 10) {
    const ids = games
      .slice(i, i + 10)
      .map((g) => g.igdbId)
      .join(',');
    try {
      const apiGames = await queryIgdb(
        `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; where id = (${ids})${adultThemeFilter}; limit 10;`,
      );
      await upsertGamesFromApi(db, apiGames);
      refreshed += apiGames.length;
    } catch (err) {
      logger.warn(`Failed to refresh batch at index ${i}: ${err}`);
    }
    await delay(250);
  }

  return refreshed;
}

/**
 * Discover popular multiplayer games from IGDB.
 * @param db - Database connection
 * @param queryIgdb - Function to execute IGDB queries
 * @param adultThemeFilter - APICALYPSE adult theme filter string
 * @returns Number of games discovered
 */
export async function discoverPopularGames(
  db: PostgresJsDatabase<typeof schema>,
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>,
  adultThemeFilter: string,
): Promise<number> {
  try {
    const popular = await queryIgdb(
      `fields ${IGDB_CONFIG.EXPANDED_FIELDS}; ` +
        `where game_modes = (2,3,5) & rating_count > 10${adultThemeFilter}; ` +
        `sort total_rating desc; limit 100;`,
    );
    await upsertGamesFromApi(db, popular);
    return popular.length;
  } catch (err) {
    logger.warn(`Failed to discover popular games: ${err}`);
    return 0;
  }
}

/**
 * Clear discovery cache from Redis after sync.
 * @param redis - Redis client
 */
export async function clearDiscoveryCache(redis: Redis): Promise<void> {
  try {
    const keys = await redis.keys('games:discover:*');
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // Non-fatal
  }
}

/**
 * Build the APICALYPSE adult theme filter string.
 * @param adultFilterEnabled - Whether adult filter is active
 * @returns Filter string for APICALYPSE queries
 */
export function buildAdultThemeFilter(adultFilterEnabled: boolean): string {
  return adultFilterEnabled
    ? ` & themes != (${ADULT_THEME_IDS.join(',')})`
    : '';
}

/**
 * Enrich games that have a Steam App ID with ITAD metadata.
 * Re-enriches ALL games every sync (no skip for already-enriched).
 * @param db - Database connection
 * @param lookupBySteamAppId - Function to look up ITAD game by Steam App ID
 * @param getGameInfo - Function to fetch full game info (including tags) by ITAD ID
 * @returns Number of successfully enriched games
 */
export async function enrichSyncedGamesWithItad(
  db: PostgresJsDatabase<typeof schema>,
  lookupBySteamAppId: (appId: number) => Promise<ItadGame | null>,
  getGameInfo: (itadId: string) => Promise<ItadGameInfo | null>,
): Promise<number> {
  const games = await db
    .select({ id: schema.games.id, steamAppId: schema.games.steamAppId })
    .from(schema.games)
    .where(isNotNull(schema.games.steamAppId));

  if (games.length === 0) return 0;

  let enriched = 0;
  for (const game of games) {
    try {
      const itadGame = await lookupBySteamAppId(game.steamAppId!);
      if (!itadGame) continue;
      const tags = await fetchTagsGracefully(getGameInfo, itadGame.id);
      await updateGameWithItadData(db, game.id, itadGame, tags);
      enriched++;
    } catch (err) {
      logger.warn(`ITAD enrichment failed for game ${game.id}: ${err}`);
    }
  }
  return enriched;
}

/** Fetch tags via getGameInfo, returning empty array on failure. */
async function fetchTagsGracefully(
  getGameInfo: (itadId: string) => Promise<ItadGameInfo | null>,
  itadId: string,
): Promise<string[]> {
  try {
    const info = await getGameInfo(itadId);
    return info?.tags ?? [];
  } catch {
    return [];
  }
}

/** Persist ITAD metadata to a game row. */
async function updateGameWithItadData(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  itadGame: ItadGame,
  tags: string[],
): Promise<void> {
  await db
    .update(schema.games)
    .set({
      itadGameId: itadGame.id,
      itadBoxartUrl: itadGame.assets?.boxart ?? null,
      itadTags: tags,
    })
    .where(eq(schema.games.id, gameId));
}

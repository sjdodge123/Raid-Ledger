import { and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import { Logger } from '@nestjs/common';
import { GameDetailDto } from '@raid-ledger/contract';
import {
  IGDB_CONFIG,
  type IgdbApiGame,
  type SearchResult,
} from './igdb.constants';
import { mapDbRowToDetail } from './igdb.mappers';
import {
  checkRedisCache,
  checkLocalDb,
  cacheToRedis,
  searchLocalGames,
  buildSearchFilters,
} from './igdb-search.helpers';

const logger = new Logger('IgdbSearchExecutor');

/** Dependencies required by search executor functions. */
export interface SearchDeps {
  db: PostgresJsDatabase<typeof schema>;
  redis: Redis;
  getAdultFilter: () => Promise<boolean>;
  fetchWithRetry: (
    query: string,
    adultFilter: boolean,
  ) => Promise<IgdbApiGame[]>;
  upsertGames: (games: IgdbApiGame[]) => Promise<GameDetailDto[]>;
  normalizeQuery: (q: string) => string;
  getCacheKey: (q: string) => string;
}

/**
 * Execute the full multi-layer search pipeline.
 * @param deps - Search dependencies
 * @param query - Raw search query
 * @param normalized - Normalized query string
 * @param triggerRefresh - Callback to trigger SWR background refresh
 * @returns Search results from cache, DB, or IGDB
 */
export async function executeSearch(
  deps: SearchDeps,
  query: string,
  normalized: string,
  triggerRefresh: (q: string, n: string, k: string) => void,
): Promise<SearchResult> {
  const cacheKey = deps.getCacheKey(query);
  const adultFilter = await deps.getAdultFilter();
  const dbFilters = buildSearchFilters(normalized, adultFilter);

  const { result, isStale } = await checkRedisCache(
    deps.redis,
    cacheKey,
    query,
  );
  if (result) {
    if (isStale) triggerRefresh(query, normalized, cacheKey);
    return result;
  }

  const dbResult = await checkLocalDb(deps.db, dbFilters, query);
  if (dbResult) {
    await cacheToRedis(deps.redis, cacheKey, dbResult.games);
    return dbResult;
  }

  return fetchFromIgdbLayer(deps, normalized, adultFilter, dbFilters, cacheKey);
}

/** Fetch from IGDB as final search fallback. */
async function fetchFromIgdbLayer(
  deps: SearchDeps,
  normalized: string,
  adultFilter: boolean,
  dbFilters: ReturnType<typeof sql>[],
  cacheKey: string,
): Promise<SearchResult> {
  try {
    const igdbGames = await deps.fetchWithRetry(normalized, adultFilter);
    if (igdbGames.length > 0) await deps.upsertGames(igdbGames);

    const fresh = await deps.db
      .select()
      .from(schema.games)
      .where(and(...dbFilters))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);
    const games = fresh.map((g) => mapDbRowToDetail(g));
    if (games.length > 0) await cacheToRedis(deps.redis, cacheKey, games);
    return { games, cached: false, source: 'igdb' };
  } catch {
    return searchLocalGames(deps.db, normalized, adultFilter);
  }
}

/**
 * Perform a SWR background refresh for a cached search query.
 * @param deps - Search dependencies
 * @param query - Raw search query
 * @param normalized - Normalized query string
 * @param cacheKey - Redis cache key
 */
export async function doSearchRefresh(
  deps: SearchDeps,
  query: string,
  normalized: string,
  cacheKey: string,
): Promise<void> {
  try {
    const adultFilter = await deps.getAdultFilter();
    const igdbGames = await deps.fetchWithRetry(normalized, adultFilter);
    if (igdbGames.length > 0) await deps.upsertGames(igdbGames);

    const dbFilters = buildSearchFilters(normalized, adultFilter);
    const fresh = await deps.db
      .select()
      .from(schema.games)
      .where(and(...dbFilters))
      .limit(IGDB_CONFIG.SEARCH_LIMIT);
    const games = fresh.map((g) => mapDbRowToDetail(g));
    if (games.length > 0) await cacheToRedis(deps.redis, cacheKey, games);
  } catch (err) {
    logger.warn(`SWR refresh failed for ${query}: ${err}`);
  }
}

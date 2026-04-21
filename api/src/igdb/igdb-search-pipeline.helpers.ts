/**
 * Search pipeline wiring for IgdbService (ROK-773).
 * Delegates to ITAD-primary or IGDB search based on availability.
 */
import { Logger } from '@nestjs/common';
import type { GameDetailDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import type { ItadService } from '../itad/itad.service';
import type { IgdbApiGame, SearchResult } from './igdb.constants';
import { buildItadSearchDeps } from './igdb-itad-deps.helpers';
import { executeItadSearch } from './igdb-itad-search.helpers';
import { deduplicateGames } from './igdb-search-dedup.helpers';
import {
  executeSearch,
  doSearchRefresh,
  type SearchDeps,
} from './igdb-search-executor.helpers';
import { fetchFromIgdb, fetchWithRetry } from './igdb-api.helpers';
import { searchLocalGames } from './igdb-search.helpers';

const logger = new Logger('IgdbSearchPipeline');

/** Parameters needed to build search dependencies. */
export interface SearchPipelineParams {
  db: PostgresJsDatabase<typeof schema>;
  redis: Redis;
  itadService: ItadService;
  resolveCredentials: () => Promise<{ clientId: string; clientSecret: string }>;
  getAccessToken: () => Promise<string>;
  clearToken: () => void;
  getAdultFilter: () => Promise<boolean>;
  upsertGames: (games: IgdbApiGame[]) => Promise<GameDetailDto[]>;
  normalizeQuery: (q: string) => string;
  getCacheKey: (q: string) => string;
  queryIgdb: (body: string) => Promise<IgdbApiGame[]>;
  /** ROK-1082: fired per successful ITAD upsert so the service can enqueue
   * a taste-vector recompute. */
  onGameUpserted?: (gameId: number) => void;
}

/**
 * Detect whether a query is a partial prefix (user still typing).
 * Returns true when there are multiple words and the last word is
 * shorter than 3 characters — e.g. "World of" or "World o".
 * In that case the ITAD enrichment pipeline (O(N) external API calls)
 * is too expensive; we fall through to IGDB/local DB which has Redis
 * caching and trigram index.
 */
export function isPartialPrefixQuery(normalized: string): boolean {
  const tokens = normalized.trim().split(/\s+/);
  return tokens.length >= 2 && tokens[tokens.length - 1].length < 3;
}

/**
 * Execute the search pipeline: ITAD-primary with IGDB fallback.
 * Skips the expensive ITAD pipeline for partial prefix queries
 * (multi-word queries where the last token is <3 chars).
 * @param params - Pipeline dependencies
 * @param query - Raw search query
 * @param normalized - Normalized query string
 * @param triggerRefresh - SWR refresh callback
 * @returns Search results
 */
export async function runSearchPipeline(
  params: SearchPipelineParams,
  query: string,
  normalized: string,
  triggerRefresh: (q: string, n: string, k: string) => void,
): Promise<SearchResult> {
  const result = await runSearchPipelineCore(
    params,
    query,
    normalized,
    triggerRefresh,
  );
  return { ...result, games: deduplicateGames(result.games) };
}

async function runSearchPipelineCore(
  params: SearchPipelineParams,
  query: string,
  normalized: string,
  triggerRefresh: (q: string, n: string, k: string) => void,
): Promise<SearchResult> {
  if (!isPartialPrefixQuery(normalized)) {
    try {
      const itadDeps = buildItadSearchDeps({
        itadService: params.itadService,
        db: params.db,
        queryIgdb: params.queryIgdb,
        getAdultFilter: params.getAdultFilter,
        onGameUpserted: params.onGameUpserted,
      });
      const result = await executeItadSearch(itadDeps, normalized);
      if (result.games.length > 0)
        return mergeLocalGames(params, result, normalized);
    } catch (err) {
      logger.debug(`ITAD search failed, trying IGDB: ${err}`);
    }
  } else {
    logger.debug(`Skipping ITAD for partial prefix query: "${normalized}"`);
  }
  const deps = buildIgdbSearchDeps(params);
  return executeSearch(deps, query, normalized, triggerRefresh);
}

/** Merge local DB matches into external results so registered games always appear. */
async function mergeLocalGames(
  params: SearchPipelineParams,
  result: SearchResult,
  normalized: string,
): Promise<SearchResult> {
  try {
    const adultFilter = await params.getAdultFilter();
    const local = await searchLocalGames(params.db, normalized, adultFilter);
    if (local.games.length === 0) return result;
    const existingSlugs = new Set(result.games.map((g) => g.slug));
    const missing = local.games.filter((g) => !existingSlugs.has(g.slug));
    if (missing.length === 0) return result;
    return { ...result, games: [...result.games, ...missing] };
  } catch {
    return result;
  }
}

/** Build IGDB-only search dependencies. */
function buildIgdbSearchDeps(params: SearchPipelineParams): SearchDeps {
  return {
    db: params.db,
    redis: params.redis,
    getAdultFilter: params.getAdultFilter,
    fetchWithRetry: async (q, af) => {
      const fetcher = async () =>
        fetchFromIgdb(
          q,
          af,
          (await params.resolveCredentials()).clientId,
          await params.getAccessToken(),
        );
      return fetchWithRetry(fetcher, params.clearToken);
    },
    upsertGames: params.upsertGames,
    normalizeQuery: params.normalizeQuery,
    getCacheKey: params.getCacheKey,
  };
}

/**
 * Trigger a SWR background refresh for a cached search query.
 * @param params - Pipeline dependencies
 * @param query - Raw search query
 * @param normalized - Normalized query string
 * @param cacheKey - Redis cache key
 * @returns Promise that resolves when refresh is done
 */
export function startSearchRefresh(
  params: SearchPipelineParams,
  query: string,
  normalized: string,
  cacheKey: string,
): Promise<void> {
  const deps = buildIgdbSearchDeps(params);
  return doSearchRefresh(deps, query, normalized, cacheKey);
}

/**
 * Trigger a search refresh if one isn't already in flight for this cache key.
 * Manages the in-flight map lifecycle so the service doesn't have to.
 */
export function triggerSearchRefreshIfNeeded(
  inFlightRefreshes: Map<string, Promise<void>>,
  params: SearchPipelineParams,
  query: string,
  normalized: string,
  cacheKey: string,
): void {
  if (inFlightRefreshes.has(cacheKey)) return;
  const promise = startSearchRefresh(
    params,
    query,
    normalized,
    cacheKey,
  ).finally(() => inFlightRefreshes.delete(cacheKey));
  inFlightRefreshes.set(cacheKey, promise);
}

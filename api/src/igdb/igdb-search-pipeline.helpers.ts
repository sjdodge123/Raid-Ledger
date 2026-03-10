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
import {
  executeSearch,
  doSearchRefresh,
  type SearchDeps,
} from './igdb-search-executor.helpers';
import { fetchFromIgdb, fetchWithRetry } from './igdb-api.helpers';

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
}

/**
 * Execute the search pipeline: ITAD-primary with IGDB fallback.
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
  try {
    const itadDeps = buildItadSearchDeps({
      itadService: params.itadService,
      db: params.db,
      queryIgdb: params.queryIgdb,
      getAdultFilter: params.getAdultFilter,
    });
    const result = await executeItadSearch(itadDeps, normalized);
    if (result.games.length > 0) return result;
  } catch (err) {
    logger.debug(`ITAD search failed, trying IGDB: ${err}`);
  }
  const deps = buildIgdbSearchDeps(params);
  return executeSearch(deps, query, normalized, triggerRefresh);
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

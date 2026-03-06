import { Logger } from '@nestjs/common';
import { and, eq, ilike, not, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import { buildWordMatchFilters } from '../common/search.util';
import { GameDetailDto } from '@raid-ledger/contract';
import {
  IGDB_CONFIG,
  ADULT_THEME_IDS,
  ADULT_KEYWORDS,
  type SearchResult,
} from './igdb.constants';
import { mapDbRowToDetail } from './igdb.mappers';

const logger = new Logger('IgdbSearchHelpers');

/** Parse raw Redis cache value into structured format. */
function parseRedisPayload(raw: string): {
  games: GameDetailDto[];
  storedAt: number | null;
} {
  const parsed = JSON.parse(raw) as
    | GameDetailDto[]
    | { storedAt: number; games: GameDetailDto[] };
  const games = Array.isArray(parsed) ? parsed : (parsed.games ?? []);
  const storedAt = Array.isArray(parsed) ? null : (parsed.storedAt ?? null);
  return { games, storedAt };
}

/** Check if cached data is stale (>80% of TTL elapsed). */
function isCacheStale(storedAt: number | null): boolean {
  if (!storedAt) return false;
  const ageMs = Date.now() - storedAt;
  const ttlMs = IGDB_CONFIG.SEARCH_CACHE_TTL * 1000;
  return ageMs >= ttlMs * 0.8;
}

/**
 * Check Redis cache for search results.
 * @returns Cached SearchResult or null if miss
 */
export async function checkRedisCache(
  redis: Redis,
  cacheKey: string,
  query: string,
): Promise<{ result: SearchResult | null; isStale: boolean }> {
  try {
    const raw = await redis.get(cacheKey);
    if (!raw) {
      logger.debug(`Redis cache miss for query: ${query}`);
      return { result: null, isStale: false };
    }

    const { games, storedAt } = parseRedisPayload(raw);
    logger.debug(`Redis cache hit for query: ${query}`);

    if (games.length === 0) {
      return { result: null, isStale: false };
    }

    return {
      result: { games, cached: true, source: 'redis' },
      isStale: isCacheStale(storedAt),
    };
  } catch (redisError) {
    logger.warn(`Redis error, falling back: ${redisError}`);
    return { result: null, isStale: false };
  }
}

/**
 * Check local database for search results.
 * @returns SearchResult or null if insufficient results
 */
export async function checkLocalDb(
  db: PostgresJsDatabase<typeof schema>,
  dbFilters: ReturnType<typeof sql>[],
  query: string,
): Promise<SearchResult | null> {
  const cachedGames = await db
    .select()
    .from(schema.games)
    .where(and(...dbFilters))
    .limit(IGDB_CONFIG.SEARCH_LIMIT);

  if (cachedGames.length >= IGDB_CONFIG.SEARCH_LIMIT) {
    logger.debug(`Database cache hit (full page) for query: ${query}`);
    return {
      games: cachedGames.map((g) => mapDbRowToDetail(g)),
      cached: true,
      source: 'database',
    };
  }
  return null;
}

/**
 * Cache search results to Redis with SWR timestamp.
 * @param redis - Redis client
 * @param key - Cache key
 * @param games - Games to cache
 */
export async function cacheToRedis(
  redis: Redis,
  key: string,
  games: GameDetailDto[],
): Promise<void> {
  try {
    await redis.setex(
      key,
      IGDB_CONFIG.SEARCH_CACHE_TTL,
      JSON.stringify({ storedAt: Date.now(), games }),
    );
    logger.debug(`Cached ${games.length} games to Redis`);
  } catch (error) {
    logger.warn(`Failed to cache to Redis: ${error}`);
  }
}

/**
 * Search local games database as fallback.
 * @param db - Database connection
 * @param query - Normalized search query
 * @param adultFilterEnabled - Whether adult filter is active
 * @returns Local search results
 */
export async function searchLocalGames(
  db: PostgresJsDatabase<typeof schema>,
  query: string,
  adultFilterEnabled: boolean,
): Promise<SearchResult> {
  const filters = [
    ...buildWordMatchFilters(schema.games.name, query),
    eq(schema.games.hidden, false),
    eq(schema.games.banned, false),
  ];
  if (adultFilterEnabled) {
    filters.push(...buildAdultFilters());
  }

  const localGames = await db
    .select()
    .from(schema.games)
    .where(and(...filters))
    .limit(IGDB_CONFIG.SEARCH_LIMIT);

  logger.debug(`Local search found ${localGames.length} games`);
  return {
    games: localGames.map((g) => mapDbRowToDetail(g)),
    cached: true,
    source: 'local',
  };
}

/**
 * Build search DB filters including adult content filtering.
 * @param normalizedQuery - Normalized search query
 * @param adultFilterEnabled - Whether adult filter is active
 * @returns Array of Drizzle filter conditions
 */
export function buildSearchFilters(
  normalizedQuery: string,
  adultFilterEnabled: boolean,
): ReturnType<typeof sql>[] {
  const filters = [
    ...buildWordMatchFilters(schema.games.name, normalizedQuery),
    eq(schema.games.hidden, false),
    eq(schema.games.banned, false),
  ];
  if (adultFilterEnabled) {
    filters.push(...buildAdultFilters());
  }
  return filters;
}

/**
 * Build Drizzle SQL filters for adult content (themes + keyword blocklist).
 * @returns Array of conditions to spread into an and() clause
 */
export function buildAdultFilters(): ReturnType<typeof sql>[] {
  return [
    sql`NOT (${schema.games.themes}::jsonb @> ANY(ARRAY[${sql.raw(ADULT_THEME_IDS.map((id) => `'[${id}]'::jsonb`).join(','))}]))`,
    not(
      or(...ADULT_KEYWORDS.map((kw) => ilike(schema.games.name, `%${kw}%`)))!,
    ),
  ];
}

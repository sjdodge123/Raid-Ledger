import { and, eq, inArray, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import { GameDetailDto } from '@raid-ledger/contract';
import { mapDbRowToDetail } from './igdb.mappers';
import { HEART_SOURCES } from './igdb-interest.helpers';
import { VISIBILITY_FILTER } from './igdb-visibility.helpers';

/** Category definition for game discovery. */
export interface DiscoverCategory {
  category: string;
  slug: string;
  cached?: boolean;
  filter?: ReturnType<typeof sql>;
  orderBy?: ReturnType<typeof sql>;
}

/** Build the list of discovery categories with SQL filters. */
export function buildDiscoverCategories(): DiscoverCategory[] {
  return [
    buildCommunityPlayingCategory(),
    buildCommunityCategory(),
    buildMostWishlistedCategory(),
    buildDealCategory('Community Wishlisted On Sale', 'wishlisted-on-sale'),
    buildDealCategory('Most Played Games On Sale', 'most-played-on-sale'),
    buildDealCategory('Best Price', 'best-price'),
    buildGenreCategory('Popular MMOs', 'popular-mmos', 5, 'popularity'),
    buildGenreCategory('Top Co-op Games', 'top-coop', 3, 'rating'),
    buildGenreCategory(
      'Trending Multiplayer',
      'trending-multiplayer',
      2,
      'popularity',
    ),
    buildReleaseDateCategory(),
    buildRatingCategory(),
  ];
}

/** Deal-aware category (no DB filter — uses custom fetch with ITAD). */
function buildDealCategory(category: string, slug: string): DiscoverCategory {
  return { category, slug, cached: false };
}

/** Most wishlisted category (ROK-418, no DB filter — uses custom fetch). */
function buildMostWishlistedCategory(): DiscoverCategory {
  return {
    category: 'Most Wishlisted',
    slug: 'most-wishlisted',
    cached: false,
  };
}

/** Community wants-to-play category (no DB filter). */
function buildCommunityCategory(): DiscoverCategory {
  return {
    category: 'Your Community Wants to Play',
    slug: 'community-wants-to-play',
    cached: false,
  };
}

/** Community has-been-playing category (ROK-565). Cache handled in its own helper. */
export function buildCommunityPlayingCategory(): DiscoverCategory {
  return {
    category: 'Your Community Has Been Playing',
    slug: 'community-has-been-playing',
    cached: true,
  };
}

/** Genre-based category with game mode filter. */
function buildGenreCategory(
  category: string,
  slug: string,
  modeId: number,
  sortField: 'popularity' | 'rating',
): DiscoverCategory {
  const col =
    sortField === 'popularity' ? schema.games.popularity : schema.games.rating;
  return {
    category,
    slug,
    filter: sql`${schema.games.gameModes}::jsonb @> '${sql.raw(String(modeId))}'::jsonb`,
    orderBy: sql`${col} DESC NULLS LAST`,
  };
}

/** Recently released category. */
function buildReleaseDateCategory(): DiscoverCategory {
  return {
    category: 'Recently Released',
    slug: 'recently-released',
    filter: sql`${schema.games.firstReleaseDate} IS NOT NULL`,
    orderBy: sql`${schema.games.firstReleaseDate} DESC NULLS LAST`,
  };
}

/** Highest rated category. */
function buildRatingCategory(): DiscoverCategory {
  return {
    category: 'Highest Rated',
    slug: 'highest-rated',
    orderBy: sql`${schema.games.aggregatedRating} DESC NULLS LAST`,
  };
}

/**
 * Fetch the "Most Wishlisted" row from game_interests (ROK-418).
 * @param db - Database connection
 * @param cat - Category definition
 * @returns Discovery row with wishlisted games
 */
export async function fetchMostWishlistedRow(
  db: PostgresJsDatabase<typeof schema>,
  cat: DiscoverCategory,
) {
  const wishlistGames = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.source, 'steam_wishlist'))
    .groupBy(schema.gameInterests.gameId)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  if (wishlistGames.length === 0) {
    return { category: cat.category, slug: cat.slug, games: [] };
  }

  return orderCommunityGames(db, cat, wishlistGames);
}

/**
 * Fetch the community "wants to play" row from game_interests.
 * @param db - Database connection
 * @param cat - Category definition
 * @returns Discovery row with games
 */
export async function fetchCommunityRow(
  db: PostgresJsDatabase<typeof schema>,
  cat: DiscoverCategory,
) {
  const interestGames = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(inArray(schema.gameInterests.source, HEART_SOURCES))
    .groupBy(schema.gameInterests.gameId)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  if (interestGames.length === 0) {
    return { category: cat.category, slug: cat.slug, games: [] };
  }

  return orderCommunityGames(db, cat, interestGames);
}

/** Fetch and order community games by interest count. */
async function orderCommunityGames(
  db: PostgresJsDatabase<typeof schema>,
  cat: DiscoverCategory,
  interestGames: { gameId: number; count: number }[],
) {
  const gameIds = interestGames.map((ig) => ig.gameId);
  const games = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.id, gameIds), VISIBILITY_FILTER()));

  const gameMap = new Map(games.map((g) => [g.id, g]));
  const orderedGames = gameIds
    .map((id) => gameMap.get(id))
    .filter(Boolean)
    .map((g) => mapDbRowToDetail(g!));

  return { category: cat.category, slug: cat.slug, games: orderedGames };
}

/** Try reading from Redis cache for a discover category. */
async function tryDiscoverCache(
  redis: Redis,
  cacheKey: string,
  cat: DiscoverCategory,
): Promise<{ category: string; slug: string; games: GameDetailDto[] } | null> {
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return {
        category: cat.category,
        slug: cat.slug,
        games: JSON.parse(cached) as GameDetailDto[],
      };
    }
  } catch {
    /* Redis miss */
  }
  return null;
}

/**
 * Fetch a standard cached category row.
 * @param db - Database connection
 * @param redis - Redis client
 * @param cat - Category definition
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with games
 */
export async function fetchCategoryRow(
  db: PostgresJsDatabase<typeof schema>,
  redis: Redis,
  cat: DiscoverCategory,
  cacheTtl: number,
) {
  const cacheKey = `games:discover:${cat.slug}`;
  const cached = await tryDiscoverCache(redis, cacheKey, cat);
  if (cached) return cached;

  const whereClause = cat.filter
    ? and(cat.filter, VISIBILITY_FILTER())
    : VISIBILITY_FILTER();

  const results = cat.orderBy
    ? await db
        .select()
        .from(schema.games)
        .where(whereClause)
        .orderBy(cat.orderBy)
        .limit(20)
    : await db.select().from(schema.games).where(whereClause).limit(20);

  const games = results.map((g) => mapDbRowToDetail(g));

  try {
    await redis.setex(cacheKey, cacheTtl, JSON.stringify(games));
  } catch {
    /* Non-fatal */
  }

  return { category: cat.category, slug: cat.slug, games };
}

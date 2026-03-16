/**
 * Deal-aware discover category helpers (ROK-803, ROK-818).
 * Fetches game rows using DB-persisted ITAD pricing data.
 * No longer calls ITAD API at request time — pricing is synced via cron.
 */
import { and, eq, gt, sql, isNotNull, inArray, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import type { GameDetailDto, GameDiscoverRowDto } from '@raid-ledger/contract';
import { HEART_SOURCES } from './igdb-interest.helpers';
import { mapDbRowToDetail } from './igdb.mappers';
import { VISIBILITY_FILTER } from './igdb-visibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

// ─── Cache helpers ───────────────────────────────────────────────────────────

/** Try reading from Redis; returns parsed games or null. */
async function tryCache(
  redis: Redis,
  slug: string,
): Promise<GameDetailDto[] | null> {
  try {
    const raw = await redis.get(`games:discover:${slug}`);
    if (raw) return JSON.parse(raw) as GameDetailDto[];
  } catch {
    /* cache miss */
  }
  return null;
}

/** Write games to Redis cache. */
async function writeCache(
  redis: Redis,
  slug: string,
  ttl: number,
  games: GameDetailDto[],
): Promise<void> {
  try {
    await redis.setex(`games:discover:${slug}`, ttl, JSON.stringify(games));
  } catch {
    /* non-fatal */
  }
}

// ─── Public fetch functions ─────────────────────────────────────────────────

/**
 * Fetch "Community Wishlisted On Sale" row.
 * Games wishlisted by community members that have an active ITAD discount.
 * @param db - Database connection
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with wishlisted-on-sale games
 */
export async function fetchWishlistedOnSaleRow(
  db: Db,
  redis: Redis,
  cacheTtl: number,
): Promise<GameDiscoverRowDto> {
  const slug = 'wishlisted-on-sale';
  const category = 'Community Wishlisted On Sale';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const games = await queryWishlistedOnSale(db);
  if (games.length > 0) await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

/**
 * Fetch "Most Played Games On Sale" row.
 * Games with the highest community playtime that have active discounts.
 * @param db - Database connection
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with most-played-on-sale games
 */
export async function fetchMostPlayedOnSaleRow(
  db: Db,
  redis: Redis,
  cacheTtl: number,
): Promise<GameDiscoverRowDto> {
  const slug = 'most-played-on-sale';
  const category = 'Most Played Games On Sale';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const games = await queryMostPlayedOnSale(db);
  if (games.length > 0) await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

/**
 * Fetch "Best Price" row.
 * Games currently at or below their historical lowest price.
 * @param db - Database connection
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with best-price games
 */
export async function fetchBestPriceRow(
  db: Db,
  redis: Redis,
  cacheTtl: number,
): Promise<GameDiscoverRowDto> {
  const slug = 'best-price';
  const category = 'Best Price';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const games = await queryBestPrice(db);
  if (games.length > 0) await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

// ─── Private query helpers ──────────────────────────────────────────────────

/** Query wishlisted games that are currently on sale via DB pricing columns. */
async function queryWishlistedOnSale(db: Db): Promise<GameDetailDto[]> {
  const rows = await db
    .select({
      game: schema.games,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
    .where(
      and(
        eq(schema.gameInterests.source, 'steam_wishlist'),
        gt(schema.games.itadCurrentCut, 0),
        VISIBILITY_FILTER(),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(sql`count(*) desc`)
    .limit(20);

  return rows.map((r) => mapDbRowToDetail(r.game));
}

/** Query most-played games that are currently on sale. */
async function queryMostPlayedOnSale(db: Db): Promise<GameDetailDto[]> {
  const rows = await db
    .select({
      game: schema.games,
      totalPlaytime:
        sql<number>`coalesce(sum(${schema.gameInterests.playtimeForever}), 0)::int`.as(
          'totalPlaytime',
        ),
    })
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
    .where(
      and(
        eq(schema.gameInterests.source, 'steam_library'),
        gt(schema.games.itadCurrentCut, 0),
        VISIBILITY_FILTER(),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(
      sql`coalesce(sum(${schema.gameInterests.playtimeForever}), 0) desc`,
    )
    .limit(20);

  return rows.map((r) => mapDbRowToDetail(r.game));
}

/** Query games at or below historical lowest price, sorted by hearts. */
async function queryBestPrice(db: Db): Promise<GameDetailDto[]> {
  const rows = await db
    .select({
      game: schema.games,
      hearts: sql<number>`count(${schema.gameInterests.id})::int`.as('hearts'),
    })
    .from(schema.games)
    .leftJoin(
      schema.gameInterests,
      and(
        eq(schema.gameInterests.gameId, schema.games.id),
        inArray(schema.gameInterests.source, HEART_SOURCES),
      ),
    )
    .where(
      and(
        gt(schema.games.itadCurrentCut, 0),
        isNotNull(schema.games.itadGameId),
        // Explicit null guards required: cut > 0 doesn't guarantee price
        // columns are non-null — a row could have a cut value from a previous
        // sync while prices were cleared by stale-pricing cleanup.
        isNotNull(schema.games.itadCurrentPrice),
        isNotNull(schema.games.itadLowestPrice),
        lte(schema.games.itadCurrentPrice, schema.games.itadLowestPrice),
        VISIBILITY_FILTER(),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(sql`count(${schema.gameInterests.id}) desc`)
    .limit(20);

  return rows.map((r) => mapDbRowToDetail(r.game));
}

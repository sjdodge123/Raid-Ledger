/**
 * Deal-aware discover category helpers (ROK-803).
 * Fetches game rows that combine community interest data with ITAD sale status.
 */
import { and, eq, sql, isNotNull, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import * as schema from '../drizzle/schema';
import type { GameDetailDto } from '@raid-ledger/contract';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';
import { HEART_SOURCES } from './igdb-interest.helpers';
import { mapDbRowToDetail } from './igdb.mappers';

type Db = PostgresJsDatabase<typeof schema>;

interface DealDiscoverRow {
  category: string;
  slug: string;
  games: GameDetailDto[];
}

/** Visibility filter for game queries (excludes hidden/banned). */
const VISIBILITY_FILTER = () =>
  and(eq(schema.games.hidden, false), eq(schema.games.banned, false));

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

// ─── ITAD filtering helpers ─────────────────────────────────────────────────

/** Build a map of itadGameId -> discount from ITAD pricing entries. */
function buildDiscountMap(
  entries: ItadOverviewGameEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.current && e.current.cut > 0) {
      map.set(e.id, e.current.cut);
    }
  }
  return map;
}

/** Build a set of itadGameIds at or below historical low ("Best Price" badge). */
function buildBestPriceSet(
  entries: ItadOverviewGameEntry[],
): Set<string> {
  const set = new Set<string>();
  for (const e of entries) {
    if (!e.current || e.current.cut <= 0 || !e.lowest) continue;
    if (e.current.price.amount <= e.lowest.price.amount) {
      set.add(e.id);
    }
  }
  return set;
}

/** Filter games to only those with active deals and map to DTOs. */
function filterOnSale(
  gameRows: (typeof schema.games.$inferSelect)[],
  discountMap: Map<string, number>,
): GameDetailDto[] {
  return gameRows
    .filter((g) => g.itadGameId && discountMap.has(g.itadGameId))
    .map((g) => mapDbRowToDetail(g));
}

// ─── Public fetch functions ─────────────────────────────────────────────────

/**
 * Fetch "Community Wishlisted On Sale" row.
 * Games that community members have wishlisted AND are currently on sale.
 * @param db - Database connection
 * @param itadPriceService - ITAD price service for fetching deals
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with wishlisted-on-sale games
 */
export async function fetchWishlistedOnSaleRow(
  db: Db,
  itadPriceService: ItadPriceService,
  redis: Redis,
  cacheTtl: number,
): Promise<DealDiscoverRow> {
  const slug = 'wishlisted-on-sale';
  const category = 'Community Wishlisted On Sale';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const wishlistGames = await queryWishlistGames(db);
  if (wishlistGames.length === 0) return { category, slug, games: [] };

  const games = await fetchAndFilterOnSale(
    db,
    itadPriceService,
    wishlistGames.map((w) => w.gameId),
  );
  await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

/**
 * Fetch "Most Played Games On Sale" row.
 * Games with the highest community playtime that are currently on sale.
 * @param db - Database connection
 * @param itadPriceService - ITAD price service for fetching deals
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with most-played-on-sale games
 */
export async function fetchMostPlayedOnSaleRow(
  db: Db,
  itadPriceService: ItadPriceService,
  redis: Redis,
  cacheTtl: number,
): Promise<DealDiscoverRow> {
  const slug = 'most-played-on-sale';
  const category = 'Most Played Games On Sale';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const playtimeGames = await queryPlaytimeGames(db);
  if (playtimeGames.length === 0) return { category, slug, games: [] };

  const onSale = await fetchAndFilterOnSale(
    db,
    itadPriceService,
    playtimeGames.map((p) => p.gameId),
  );
  const games = await sortByHearts(db, onSale);
  await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

/**
 * Fetch "Best Price" row.
 * Games with the deepest current discounts from ITAD.
 * @param db - Database connection
 * @param itadPriceService - ITAD price service for fetching deals
 * @param redis - Redis client for caching
 * @param cacheTtl - Cache TTL in seconds
 * @returns Discovery row with best-price games
 */
export async function fetchBestPriceRow(
  db: Db,
  itadPriceService: ItadPriceService,
  redis: Redis,
  cacheTtl: number,
): Promise<DealDiscoverRow> {
  const slug = 'best-price';
  const category = 'Best Price';
  const cached = await tryCache(redis, slug);
  if (cached) return { category, slug, games: cached };

  const gameRows = await queryGamesWithItadId(db);
  if (gameRows.length === 0) return { category, slug, games: [] };

  const itadIds = gameRows.map((g) => g.itadGameId).filter(Boolean) as string[];
  const entries = await itadPriceService.getOverviewBatch(itadIds);
  const bestPriceIds = buildBestPriceSet(entries);

  const filtered = gameRows
    .filter((g) => g.itadGameId && bestPriceIds.has(g.itadGameId))
    .map((g) => mapDbRowToDetail(g));

  const games = await sortByHearts(db, filtered);
  await writeCache(redis, slug, cacheTtl, games);
  return { category, slug, games };
}

// ─── Private query helpers ──────────────────────────────────────────────────

/** Query top wishlisted games from game_interests. */
async function queryWishlistGames(db: Db) {
  return db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.source, 'steam_wishlist'))
    .groupBy(schema.gameInterests.gameId)
    .orderBy(sql`count(*) desc`)
    .limit(50);
}

/** Query top games by total playtime from game_interests. */
async function queryPlaytimeGames(db: Db) {
  return db
    .select({
      gameId: schema.gameInterests.gameId,
      totalPlaytime:
        sql<number>`coalesce(sum(${schema.gameInterests.playtimeForever}), 0)::int`.as(
          'totalPlaytime',
        ),
    })
    .from(schema.gameInterests)
    .where(eq(schema.gameInterests.source, 'steam_library'))
    .groupBy(schema.gameInterests.gameId)
    .orderBy(
      sql`coalesce(sum(${schema.gameInterests.playtimeForever}), 0) desc`,
    )
    .limit(50);
}

/** Query all visible games that have an ITAD game ID. */
async function queryGamesWithItadId(db: Db) {
  return db
    .select()
    .from(schema.games)
    .where(and(isNotNull(schema.games.itadGameId), VISIBILITY_FILTER()));
}

/** Query heart counts for a list of game IDs. */
async function queryHeartCounts(
  db: Db,
  gameIds: number[],
): Promise<Map<number, number>> {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      gameId: schema.gameInterests.gameId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.gameInterests)
    .where(
      and(
        inArray(schema.gameInterests.gameId, gameIds),
        inArray(schema.gameInterests.source, HEART_SOURCES),
      ),
    )
    .groupBy(schema.gameInterests.gameId);
  return new Map(rows.map((r) => [r.gameId, r.count]));
}

/** Sort games by heart count descending, take top 20. */
async function sortByHearts(
  db: Db,
  games: GameDetailDto[],
): Promise<GameDetailDto[]> {
  if (games.length === 0) return [];
  const hearts = await queryHeartCounts(db, games.map((g) => g.id));
  return games
    .sort((a, b) => (hearts.get(b.id) ?? 0) - (hearts.get(a.id) ?? 0))
    .slice(0, 20);
}

/** Fetch game rows and ITAD pricing, return only on-sale games. */
async function fetchAndFilterOnSale(
  db: Db,
  itadPriceService: ItadPriceService,
  gameIds: number[],
): Promise<GameDetailDto[]> {
  const gameRows = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.id, gameIds), VISIBILITY_FILTER()));

  const itadIds = gameRows.map((g) => g.itadGameId).filter(Boolean) as string[];
  if (itadIds.length === 0) return [];

  const entries = await itadPriceService.getOverviewBatch(itadIds);
  const discountMap = buildDiscountMap(entries);
  return filterOnSale(gameRows, discountMap).slice(0, 20);
}

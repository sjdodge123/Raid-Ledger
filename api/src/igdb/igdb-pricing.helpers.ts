/**
 * ITAD pricing helpers for the IGDB controller (ROK-419, ROK-1047).
 * Maps ITAD overview data to the ItadGamePricing contract schema.
 *
 * ROK-1047: the batch path no longer blocks on ITAD. Cached rows return
 * immediately; uncached / stale rows return null and are enqueued for
 * an out-of-band fetch via the optional `enqueueSync` callback.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadGamePricingDto, DealQuality } from '@raid-ledger/contract';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';
import { PRICING_STALE_MS } from '../itad/itad-price-sync.constants';

/** Thresholds for deal quality classification */
const GREAT_DEAL_THRESHOLD = 0.1;
const GOOD_DEAL_THRESHOLD = 0.25;

/**
 * Fetch and map pricing data for a game.
 * Returns null if the game has no ITAD ID or pricing is unavailable.
 */
export async function fetchGamePricing(
  db: PostgresJsDatabase<typeof schema>,
  itadPriceService: ItadPriceService,
  gameId: number,
): Promise<ItadGamePricingDto | null> {
  const itadGameId = await lookupItadGameId(db, gameId);
  if (!itadGameId) return null;

  const overview = await itadPriceService.getOverview(itadGameId);
  if (!overview) return null;

  return mapOverviewToPricing(overview);
}

/** Look up the ITAD game ID from the games table. */
async function lookupItadGameId(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
): Promise<string | null> {
  const rows = await db
    .select({ itadGameId: schema.games.itadGameId })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return rows[0]?.itadGameId ?? null;
}

/**
 * Fetch and map pricing data for multiple games in one batch (ROK-1047).
 *
 * Returns cached prices immediately. Uncached or stale rows return
 * `null` and are enqueued via `enqueueSync` for out-of-band ITAD fetch.
 * The frontend polls until the cache backfills.
 *
 * `itadPriceService` is unused by the batch path now but kept on the
 * signature so callers don't need to change wiring; prefer the
 * 4-arg form in new code.
 */
export async function fetchBatchGamePricing(
  db: PostgresJsDatabase<typeof schema>,
  _itadPriceService: ItadPriceService | null,
  gameIds: number[],
  enqueueSync?: (gameId: number) => void,
): Promise<Record<string, ItadGamePricingDto | null>> {
  if (gameIds.length === 0) return {};

  const idMap = await lookupBatchItadIds(db, gameIds);
  const cached = await lookupCachedPricing(db, gameIds);
  const freshCached = cached.filter((r) => !isStale(r.itadPriceUpdatedAt));
  const freshIds = new Set(freshCached.map((r) => r.id));

  if (enqueueSync) {
    for (const gid of gameIds) {
      if (freshIds.has(gid)) continue;
      if (!idMap[gid]) continue; // no ITAD ID — nothing to fetch
      enqueueSync(gid);
    }
  }

  return mergeBatchResults(gameIds, freshCached);
}

/** A cached row is stale if older than PRICING_STALE_MS. */
function isStale(updatedAt: Date | string | null): boolean {
  if (!updatedAt) return true;
  const t =
    typeof updatedAt === 'string' ? Date.parse(updatedAt) : updatedAt.getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > PRICING_STALE_MS;
}

/** Shape of a cached pricing row from the DB. */
interface DbPricingRow {
  id: number;
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
  itadPriceUpdatedAt: Date | string | null;
}

/** Look up ITAD game IDs for multiple games in a single query. */
async function lookupBatchItadIds(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
): Promise<Record<number, string | null>> {
  const rows = await db
    .select({ id: schema.games.id, itadGameId: schema.games.itadGameId })
    .from(schema.games)
    .where(inArray(schema.games.id, gameIds));

  const map: Record<number, string | null> = {};
  for (const row of rows) map[row.id] = row.itadGameId;
  return map;
}

/**
 * Query DB for games with cached ITAD pricing data (ROK-854, ROK-1047).
 * Includes the updated_at timestamp so the caller can detect stale rows.
 */
async function lookupCachedPricing(
  db: PostgresJsDatabase<typeof schema>,
  gameIds: number[],
): Promise<DbPricingRow[]> {
  const rows = await db
    .select({
      id: schema.games.id,
      itadCurrentPrice: schema.games.itadCurrentPrice,
      itadCurrentCut: schema.games.itadCurrentCut,
      itadCurrentShop: schema.games.itadCurrentShop,
      itadCurrentUrl: schema.games.itadCurrentUrl,
      itadLowestPrice: schema.games.itadLowestPrice,
      itadLowestCut: schema.games.itadLowestCut,
      itadPriceUpdatedAt: schema.games.itadPriceUpdatedAt,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, gameIds));
  return rows.filter((r) => r.itadPriceUpdatedAt != null);
}

/**
 * Build the response map from fresh cached DB rows. Uncached or stale
 * games map to null — frontend treats null as "pending fetch" and polls
 * (ROK-1047).
 */
function mergeBatchResults(
  gameIds: number[],
  cached: DbPricingRow[],
): Record<string, ItadGamePricingDto | null> {
  const cacheMap = new Map(cached.map((r) => [r.id, r]));
  const result: Record<string, ItadGamePricingDto | null> = {};
  for (const gid of gameIds) {
    const cachedRow = cacheMap.get(gid);
    result[String(gid)] = cachedRow ? mapDbRowToPricing(cachedRow) : null;
  }
  return result;
}

/**
 * Map a DB row with cached pricing columns to ItadGamePricingDto.
 * Fields not stored in DB cache (regularPrice, historyLow.shop,
 * historyLow.date) are set to null (ROK-854).
 */
export function mapDbRowToPricing(row: {
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
}): ItadGamePricingDto | null {
  if (
    !row.itadCurrentPrice &&
    row.itadCurrentCut === null &&
    !row.itadLowestPrice
  ) {
    return null;
  }
  const currentBest = buildCacheCurrent(row);
  const historyLow = buildCacheHistoryLow(row);
  const dealQuality = computeDealQuality(currentBest, historyLow);
  const stores = currentBest ? [currentBest] : [];
  return {
    currentBest,
    stores,
    historyLow,
    dealQuality,
    currency: 'USD',
    itadUrl: null,
  };
}

/** Build currentBest from cached DB row. */
function buildCacheCurrent(row: {
  itadCurrentPrice: string | null;
  itadCurrentCut: number | null;
  itadCurrentShop: string | null;
  itadCurrentUrl: string | null;
}): ItadGamePricingDto['currentBest'] {
  if (row.itadCurrentPrice == null) return null;
  return {
    shop: row.itadCurrentShop ?? 'Unknown',
    url: row.itadCurrentUrl ?? '',
    price: parseFloat(row.itadCurrentPrice),
    regularPrice: null,
    discount: row.itadCurrentCut ?? 0,
  };
}

/** Build historyLow from cached DB row. */
function buildCacheHistoryLow(row: {
  itadLowestPrice: string | null;
  itadLowestCut: number | null;
}): ItadGamePricingDto['historyLow'] {
  if (row.itadLowestPrice == null) return null;
  return { price: parseFloat(row.itadLowestPrice), shop: null, date: null };
}

/** Map an ITAD overview game entry to the contract pricing shape. */
export function mapOverviewToPricing(
  entry: ItadOverviewGameEntry,
): ItadGamePricingDto {
  const currentBest = mapCurrentBest(entry);
  const stores = currentBest ? [currentBest] : [];
  const historyLow = mapHistoryLow(entry);
  const currency = entry.current?.price?.currency ?? 'USD';
  const dealQuality = computeDealQuality(currentBest, historyLow);
  const itadUrl = entry.urls?.game ?? null;

  return { currentBest, stores, historyLow, dealQuality, currency, itadUrl };
}

/** Map the current best deal from the overview entry. */
function mapCurrentBest(
  entry: ItadOverviewGameEntry,
): ItadGamePricingDto['currentBest'] {
  if (!entry.current) return null;
  return {
    shop: entry.current.shop.name,
    url: entry.current.url,
    price: entry.current.price.amount,
    regularPrice: entry.current.regular.amount,
    discount: entry.current.cut,
  };
}

/** Map the historical low from the overview entry, or null. */
function mapHistoryLow(
  entry: ItadOverviewGameEntry,
): ItadGamePricingDto['historyLow'] {
  if (!entry.lowest) return null;
  return {
    price: entry.lowest.price.amount,
    shop: entry.lowest.shop.name,
    date: entry.lowest.timestamp,
  };
}

/**
 * Compute deal quality based on current best vs. historical low.
 * - 'great': within 10% of historical low
 * - 'good': within 25% of historical low
 * - 'modest': any other discount
 * - null: no discount or no data
 */
function computeDealQuality(
  currentBest: ItadGamePricingDto['currentBest'],
  historyLow: ItadGamePricingDto['historyLow'],
): DealQuality {
  if (!currentBest || currentBest.discount <= 0) return null;
  if (!historyLow || historyLow.price <= 0) return 'modest';

  const ratio = (currentBest.price - historyLow.price) / historyLow.price;
  if (ratio <= GREAT_DEAL_THRESHOLD) return 'great';
  if (ratio <= GOOD_DEAL_THRESHOLD) return 'good';
  return 'modest';
}

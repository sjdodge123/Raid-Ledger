/**
 * ITAD pricing helpers for the IGDB controller (ROK-419).
 * Maps ITAD overview data to the ItadGamePricing contract schema.
 */
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadGamePricingDto, DealQuality } from '@raid-ledger/contract';
import type { ItadOverviewGameEntry } from '../itad/itad-price.types';

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
 * Fetch and map pricing data for multiple games in one batch.
 * Returns a Record of gameId -> pricing or null.
 */
export async function fetchBatchGamePricing(
  db: PostgresJsDatabase<typeof schema>,
  itadPriceService: ItadPriceService,
  gameIds: number[],
): Promise<Record<string, ItadGamePricingDto | null>> {
  if (gameIds.length === 0) return {};

  const idMap = await lookupBatchItadIds(db, gameIds);
  const itadIds = Object.values(idMap).filter(Boolean) as string[];
  const entries =
    itadIds.length > 0 ? await itadPriceService.getOverviewBatch(itadIds) : [];
  return buildBatchResult(gameIds, idMap, entries);
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

/** Build the batch result mapping game IDs to pricing data. */
function buildBatchResult(
  gameIds: number[],
  idMap: Record<number, string | null>,
  entries: ItadOverviewGameEntry[],
): Record<string, ItadGamePricingDto | null> {
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const result: Record<string, ItadGamePricingDto | null> = {};
  for (const gid of gameIds) {
    const itadId = idMap[gid];
    const entry = itadId ? entryMap.get(itadId) : null;
    result[String(gid)] = entry ? mapOverviewToPricing(entry) : null;
  }
  return result;
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

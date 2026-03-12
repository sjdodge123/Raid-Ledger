/**
 * ITAD pricing helpers for the IGDB controller (ROK-419).
 * Maps ITAD overview data to the ItadGamePricing contract schema.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadPriceService } from '../itad/itad-price.service';
import type { ItadGamePricingDto, DealQuality } from '@raid-ledger/contract';
import type {
  ItadOverviewEntry,
  ItadOverviewPrice,
} from '../itad/itad-price.types';

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

/** Map an ITAD overview entry to the contract pricing shape. */
function mapOverviewToPricing(overview: ItadOverviewEntry): ItadGamePricingDto {
  const stores = overview.prices.map(mapStorePrice);
  const currentBest = findBestPrice(stores);
  const historyLow = mapHistoryLow(overview);
  const currency = extractCurrency(overview);
  const dealQuality = computeDealQuality(currentBest, historyLow);

  return { currentBest, stores, historyLow, dealQuality, currency };
}

/** Map a single ITAD price entry to the contract store price shape. */
function mapStorePrice(
  p: ItadOverviewPrice,
): ItadGamePricingDto['stores'][number] {
  return {
    shop: p.shop.name,
    url: p.url,
    price: p.price.amount,
    regularPrice: p.regular.amount,
    discount: p.cut,
  };
}

/** Find the lowest-priced store entry, or null if no stores. */
function findBestPrice(
  stores: ItadGamePricingDto['stores'],
): ItadGamePricingDto['currentBest'] {
  if (stores.length === 0) return null;
  return stores.reduce((best, s) => (s.price < best.price ? s : best));
}

/** Map the historical low from the overview, or null. */
function mapHistoryLow(
  overview: ItadOverviewEntry,
): ItadGamePricingDto['historyLow'] {
  if (!overview.lowest) return null;
  return {
    price: overview.lowest.price.amount,
    shop: overview.lowest.shop.name,
    date: overview.lowest.recorded,
  };
}

/** Extract currency from the first price entry, defaulting to 'USD'. */
function extractCurrency(overview: ItadOverviewEntry): string {
  return overview.prices[0]?.price.currency ?? 'USD';
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

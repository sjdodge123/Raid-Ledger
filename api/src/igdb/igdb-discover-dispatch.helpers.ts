/**
 * Discover category dispatch helper (ROK-803).
 * Routes each category slug to its appropriate fetch function.
 * Extracted from igdb.controller.ts to stay within file size limits.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import type * as schema from '../drizzle/schema';
import type { GameDiscoverRowDto } from '@raid-ledger/contract';
import type { ItadPriceService } from '../itad/itad-price.service';
import {
  fetchCommunityRow,
  fetchMostWishlistedRow,
  fetchCategoryRow,
  type DiscoverCategory,
} from './igdb-discover.helpers';
import {
  fetchWishlistedOnSaleRow,
  fetchMostPlayedOnSaleRow,
  fetchBestPriceRow,
} from './igdb-discover-deals.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Deal-aware slug set for fast lookup. */
const DEAL_SLUGS = new Set([
  'wishlisted-on-sale',
  'most-played-on-sale',
  'best-price',
]);

/**
 * Dispatch a single discover category to its fetch function.
 * @param cat - Category definition
 * @param db - Database connection
 * @param redis - Redis client
 * @param cacheTtl - Cache TTL in seconds
 * @param itadPriceService - ITAD price service for deal categories
 * @returns Discovery row with games
 */
export async function dispatchDiscoverRow(
  cat: DiscoverCategory,
  db: Db,
  redis: Redis,
  cacheTtl: number,
  itadPriceService: ItadPriceService,
): Promise<GameDiscoverRowDto> {
  if (cat.slug === 'community-wants-to-play') {
    return fetchCommunityRow(db, cat);
  }
  if (cat.slug === 'most-wishlisted') {
    return fetchMostWishlistedRow(db, cat);
  }
  if (cat.slug === 'wishlisted-on-sale') {
    return fetchWishlistedOnSaleRow(db, itadPriceService, redis, cacheTtl);
  }
  if (cat.slug === 'most-played-on-sale') {
    return fetchMostPlayedOnSaleRow(db, itadPriceService, redis, cacheTtl);
  }
  if (cat.slug === 'best-price') {
    return fetchBestPriceRow(db, itadPriceService, redis, cacheTtl);
  }
  return fetchCategoryRow(db, redis, cat, cacheTtl);
}

/**
 * Check if a slug is a deal-aware category.
 * @param slug - Category slug to check
 * @returns true if slug requires ITAD price service
 */
export function isDealSlug(slug: string): boolean {
  return DEAL_SLUGS.has(slug);
}

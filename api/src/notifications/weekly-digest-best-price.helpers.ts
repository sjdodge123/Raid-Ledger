/**
 * Weekly digest v2 — "🏷 Best price" read (ROK-1771 §11, lane L7).
 *
 * Replaces v1's "On sale" (any discount): a game qualifies only when it is
 * BOTH wishlisted by the community (`game_interests.source = 'steam_wishlist'`)
 * AND at its all-time low per the shared {@link bestPriceCondition} — the
 * same predicate as the discover "Best Price" row and the web price badge.
 * There is no any-discount fallback; an empty result hides the section.
 *
 * Privacy: mirrors v1's deals source (`fetchWishlistedOnSaleRow`), which
 * counted wishlists with NO per-user `show_activity` predicate. The digest
 * shows only an aggregate count, never a name, so no opt-out is applied here.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { bestPriceCondition } from '../igdb/igdb-discover-deals.helpers';
import { VISIBILITY_FILTER } from '../igdb/igdb-visibility.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Top-N for the best-price section (spec §11). */
export const DIGEST_BEST_PRICE_LIMIT = 3;

export interface DigestBestPriceLine {
  gameId: number;
  name: string;
  /** For the masked game link, same as v1's `DigestGameRef.slug`. */
  slug: string;
  /** Discount percentage, 1–100. */
  cutPercent: number;
  /** Current price (always present — the best-price rule requires it). */
  price: number;
  /** Distinct community members with the game on their Steam wishlist. */
  wishlisters: number;
}

export interface DigestBestPriceSection {
  items: DigestBestPriceLine[];
  /** Every qualifying game, before the top-N cut. */
  total: number;
}

/** Raw row shape returned by {@link fetchWishlistedBestPrice}'s query. */
export interface BestPriceQueryRow {
  gameId: number;
  name: string;
  slug: string;
  cut: number | null;
  price: string | null;
  wishlisters: number;
  total: number;
}

/** Pure: numeric-string prices → numbers; a row without a usable price is dropped. */
export function shapeBestPriceRows(
  rows: BestPriceQueryRow[],
): DigestBestPriceSection {
  const items: DigestBestPriceLine[] = [];
  for (const row of rows) {
    const price = row.price === null ? NaN : Number(row.price);
    if (!Number.isFinite(price)) continue;
    items.push({
      gameId: row.gameId,
      name: row.name,
      slug: row.slug,
      cutPercent: row.cut ?? 0,
      price,
      wishlisters: row.wishlisters,
    });
  }
  return { items, total: rows[0]?.total ?? 0 };
}

const wishlisterCount = () =>
  sql<number>`count(distinct ${schema.gameInterests.userId})::int`;

const bestPriceColumns = () => ({
  gameId: schema.games.id,
  name: schema.games.name,
  slug: schema.games.slug,
  cut: schema.games.itadCurrentCut,
  price: schema.games.itadCurrentPrice,
  wishlisters: wishlisterCount().as('wishlisters'),
  // Window over the grouped rows = number of qualifying games.
  total: sql<number>`(count(*) over ())::int`.as('total'),
});

/**
 * Community-wishlisted games at their all-time low, ordered by distinct
 * wishlisters desc, then cut desc (id asc as a stable tie-break).
 */
export async function fetchWishlistedBestPrice(
  db: Db,
  limit: number = DIGEST_BEST_PRICE_LIMIT,
): Promise<DigestBestPriceSection> {
  const rows = await db
    .select(bestPriceColumns())
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.gameInterests.gameId, schema.games.id))
    .where(
      and(
        eq(schema.gameInterests.source, 'steam_wishlist'),
        bestPriceCondition(),
        VISIBILITY_FILTER(),
      ),
    )
    .groupBy(schema.games.id)
    .orderBy(
      desc(wishlisterCount()),
      desc(schema.games.itadCurrentCut),
      asc(schema.games.id),
    )
    .limit(limit);
  return shapeBestPriceRows(rows);
}

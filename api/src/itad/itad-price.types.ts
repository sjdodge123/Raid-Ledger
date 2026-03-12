/**
 * ITAD API price-related response shapes (ROK-419).
 * These mirror the IsThereAnyDeal v2 API response format.
 */

/** A single price entry from the ITAD overview endpoint */
export interface ItadOverviewPrice {
  /** ITAD numeric shop ID */
  shop: { id: number; name: string };
  /** Current price value */
  price: { amount: number; amountInt: number; currency: string };
  /** Regular (non-sale) price */
  regular: { amount: number; amountInt: number; currency: string };
  /** Discount percentage (0-100) */
  cut: number;
  /** Direct buy URL */
  url: string;
}

/** Historical low from the ITAD overview endpoint */
export interface ItadOverviewHistoryLow {
  /** The lowest recorded price */
  price: { amount: number; amountInt: number; currency: string };
  /** Shop that had the lowest price */
  shop: { id: number; name: string };
  /** ISO date string of when the historical low occurred */
  recorded: string;
}

/** Single game overview response from POST /games/overview/v2 */
export interface ItadOverviewEntry {
  /** Current prices across stores */
  prices: ItadOverviewPrice[];
  /** All-time historical lowest price */
  lowest: ItadOverviewHistoryLow | null;
}

/**
 * Full response from POST /games/overview/v2.
 * Maps ITAD game ID -> overview entry.
 */
export type ItadOverviewResponse = Record<string, ItadOverviewEntry>;

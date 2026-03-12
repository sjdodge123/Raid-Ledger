/**
 * ITAD API price-related response shapes (ROK-419).
 * These mirror the IsThereAnyDeal v2 API response format
 * for POST /games/overview/v2.
 */

/** Price amount fields returned by ITAD */
export interface ItadPriceAmount {
  amount: number;
  amountInt: number;
  currency: string;
}

/** Shop reference from ITAD */
export interface ItadShopRef {
  id: number;
  name: string;
}

/** Current best deal from POST /games/overview/v2 */
export interface ItadCurrentDeal {
  shop: ItadShopRef;
  price: ItadPriceAmount;
  regular: ItadPriceAmount;
  cut: number;
  url: string;
  voucher?: string | null;
  flag?: string | null;
  timestamp?: string;
  expiry?: string | null;
}

/** Historical lowest price from POST /games/overview/v2 */
export interface ItadHistoricalLow {
  shop: ItadShopRef;
  price: ItadPriceAmount;
  regular: ItadPriceAmount;
  cut: number;
  timestamp: string;
}

/** A single game entry in the overview response */
export interface ItadOverviewGameEntry {
  id: string;
  current: ItadCurrentDeal;
  lowest: ItadHistoricalLow;
  bundled: number;
  urls: { game: string };
}

/** Full response from POST /games/overview/v2 */
export interface ItadOverviewResponse {
  prices: ItadOverviewGameEntry[];
  bundles: unknown[];
}

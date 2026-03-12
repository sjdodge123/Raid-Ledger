import type { ItadGamePricingDto } from '@raid-ledger/contract';

export type BadgeType = 'best-price' | 'on-sale' | null;

/** Determine badge type from pricing data. */
export function getPriceBadgeType(
  pricing: ItadGamePricingDto | null,
): BadgeType {
  if (!pricing?.currentBest || pricing.currentBest.discount <= 0) return null;
  if (
    pricing.historyLow &&
    pricing.currentBest.price <= pricing.historyLow.price
  ) {
    return 'best-price';
  }
  return 'on-sale';
}

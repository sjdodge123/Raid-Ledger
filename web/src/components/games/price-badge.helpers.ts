import type { ItadGamePricingDto } from '@raid-ledger/contract';

export type BadgeType = 'best-price' | 'on-sale' | null;

/**
 * Loose price scalars as they arrive on the lineup / Common Ground DTOs.
 * These carry the same three facts `ItadGamePricingDto` does, just flattened.
 */
export interface PriceBadgeScalars {
  /** Current discount percentage (0-100). */
  cut: number | null | undefined;
  /** Current best price. */
  price: number | null | undefined;
  /** Historical lowest price ever observed via ITAD. */
  lowestPrice: number | null | undefined;
}

/**
 * ROK-1314: the ONE price rule, reachable from loose scalars.
 *
 * Spec §0 vocabulary lock — `best-price` only when a discount exists AND the
 * current price is at or below the historical low; `on-sale` for any other
 * live discount; `null` when there is no discount. A missing `lowestPrice`
 * (legacy row) resolves `on-sale`, never `best-price` (edge case §7.5).
 */
export function getPriceBadgeTypeFromScalars({
  cut,
  price,
  lowestPrice,
}: PriceBadgeScalars): BadgeType {
  if (cut == null || cut <= 0) return null;
  if (price != null && lowestPrice != null && price <= lowestPrice) {
    return 'best-price';
  }
  return 'on-sale';
}

/**
 * Determine badge type from an ITAD pricing payload.
 *
 * Delegates to {@link getPriceBadgeTypeFromScalars} — two entry points, ONE
 * rule. Never fork the logic (spec §0).
 */
export function getPriceBadgeType(
  pricing: ItadGamePricingDto | null,
): BadgeType {
  return getPriceBadgeTypeFromScalars({
    cut: pricing?.currentBest?.discount ?? null,
    price: pricing?.currentBest?.price ?? null,
    lowestPrice: pricing?.historyLow?.price ?? null,
  });
}

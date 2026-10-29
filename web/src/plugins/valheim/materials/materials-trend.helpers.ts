/**
 * ROK-2014 — the Materials item rows' trend: the shared Valheim trend chip
 * (`../trend/`) bound to whole items and the noun "day" ("+45 over 3 days").
 * The API sends one `trend` per row set (shared, each base, personal, each
 * personal base); the Base filter is client-side, so the active base picks
 * its own trend exactly as `sharedTotalsFor` picks its totals.
 */
import type {
    ValheimMaterialsBase,
    ValheimMaterialsResponse,
    ValheimMaterialsTrend,
} from '@raid-ledger/contract';
import { trendFor, type TrendFormat, type TrendSummary } from '../trend/trend.helpers';

/** Materials: whole items, thousands separators, "… over 3 days". */
export const MATERIALS_TREND_FORMAT: TrendFormat = { decimals: 0, noun: 'day' };

/** One item's trend, or null with no history or a zero net change (no chip). */
export function itemTrendFor(
    prefab: string,
    trend: ValheimMaterialsTrend | undefined,
): TrendSummary | null {
    return trendFor(prefab, trend, MATERIALS_TREND_FORMAT.decimals);
}

/** Each shown row's trend, keyed by prefab; rows without one are left out. */
export function rowTrends(
    rows: readonly { prefab: string }[],
    trend: ValheimMaterialsTrend | undefined,
): ReadonlyMap<string, TrendSummary> {
    const out = new Map<string, TrendSummary>();
    if (trend === undefined) return out;
    for (const r of rows) {
        const t = itemTrendFor(r.prefab, trend);
        if (t !== null) out.set(r.prefab, t);
    }
    return out;
}

/** The shared rows' trend: the selected base's own, or every shared chest's. */
export function sharedTrendFor(
    data: ValheimMaterialsResponse,
    base: ValheimMaterialsBase | null,
): ValheimMaterialsTrend | undefined {
    return base === null ? data.shared.trend : base.trend;
}

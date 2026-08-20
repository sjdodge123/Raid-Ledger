/**
 * Co-op capacity resolution for nomination surfaces (ROK-1400).
 *
 * Mirrors the `minOnlineCoop` SQL filter in
 * `api/src/lineups/common-ground-query.helpers.ts` so the badge a user sees
 * in the NominateModal agrees with the picker's filter. Advisory only —
 * nothing here blocks a nomination (operator decision: soft filter, no hard
 * gate).
 */

/** Minimal co-op shape shared by search results and suggestion rows. */
export interface CoopCapacityFields {
    cooptimusOnlineMax?: number | null;
    playerCount?: { min: number; max: number } | null;
}

/**
 * Effective online-co-op max (operator-ratified 2026-08-20):
 *   `cooptimusOnlineMax` non-null → use it, INCLUDING zero
 *   `cooptimusOnlineMax` null     → fall back to IGDB `playerCount.max`
 *   neither populated             → null (nothing to show or compare)
 *
 * A ZERO cooptimus value is a synced "this game has NO online co-op" claim,
 * so it resolves to 0 and fails every group size — it must NOT fall through
 * to the IGDB number, which for PvP titles is a large lobby capacity that
 * has nothing to do with co-op.
 *
 * This deliberately DIVERGES from the API's `resolvePlayerCap` (ROK-1411),
 * which treats zero as absent because it answers a different question
 * ("what cap do we print on the roster copy?").
 */
export function resolveEffectiveOnlineMax(
    cooptimusOnlineMax: number | null | undefined,
    playerCountMax: number | null | undefined,
): number | null {
    if (cooptimusOnlineMax != null) return cooptimusOnlineMax;
    return playerCountMax ?? null;
}

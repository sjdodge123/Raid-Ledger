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
    /** ROK-1401: feeds the shared `coopLabel` (`>= 2` means local co-op). */
    cooptimusCouchMax?: number | null;
    /** ROK-1401: Co-Optimus `Combo Co-Op (Local + Online)` flag. */
    cooptimusComboCoop?: boolean | null;
}

/**
 * Effective online-co-op max — **Co-Optimus-verified only** (operator
 * decision 2026-08-20 round 2):
 *   `cooptimusOnlineMax` present → use it, INCLUDING zero
 *   `cooptimusOnlineMax` absent  → null (no data; show nothing, warn nothing)
 *
 * IGDB `playerCount.max` is deliberately NOT consulted: it is a lobby-size
 * estimate, not a co-op capability, and falling back to it let PvP titles
 * (PUBG et al) look like large-group co-op games. A ZERO is real data — the
 * sync ran and found no online co-op — so it resolves to 0 and warns.
 *
 * This deliberately DIVERGES from the API's `resolvePlayerCap` (ROK-1411),
 * which does fall back to player_count because it answers a display
 * question, not a filter-correctness one.
 */
export function resolveEffectiveOnlineMax(
    cooptimusOnlineMax: number | null | undefined,
): number | null {
    return cooptimusOnlineMax ?? null;
}

/**
 * Co-op capacity resolution for nomination surfaces (ROK-1400).
 *
 * Mirrors the API's `resolvePlayerCap` (ROK-1411) so the badge a user sees
 * in the NominateModal agrees with the `minOnlineCoop` filter the Common
 * Ground picker applies server-side. Advisory only — nothing here blocks a
 * nomination (operator decision: soft filter, no hard gate).
 */

/** Minimal co-op shape shared by search results and suggestion rows. */
export interface CoopCapacityFields {
    cooptimusOnlineMax?: number | null;
    playerCount?: { min: number; max: number } | null;
}

/**
 * Effective online-co-op max: a POSITIVE `cooptimusOnlineMax` wins over the
 * IGDB `playerCount.max` (Co-Optimus measures online co-op; IGDB's max is
 * generic lobby capacity), a ZERO cooptimus value is a "no online co-op
 * recorded" claim rather than a capacity of zero so it falls THROUGH, and
 * with neither source populated there is no cap to show at all.
 */
export function resolveEffectiveOnlineMax(
    cooptimusOnlineMax: number | null | undefined,
    playerCountMax: number | null | undefined,
): number | null {
    if (cooptimusOnlineMax != null && cooptimusOnlineMax > 0) {
        return cooptimusOnlineMax;
    }
    return playerCountMax ?? null;
}

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

/**
 * ROK-1401: compact co-op fit badge copy for VotingRow / MatchCard.
 *
 * A CO-OP CLAIM, so it is Co-Optimus-verified ONLY — `onlineMax` must be a
 * positive synced value. `0` (synced, no online co-op), `null`/`undefined`
 * (never synced, or a stale cached row missing the field) and any negative
 * value all return `null`, and the caller renders NO element at all: no
 * placeholder, no layout hole. IGDB `playerCount` is never consulted here —
 * a lobby size is not a co-op capability. The API's `resolvePlayerCap` /
 * `classifyFit` DO fall back to IGDB because they answer the CAPACITY
 * question. Two rules, two concerns — do not unify them.
 *
 * Copy asymmetry is deliberate: the FITS label names the GROUP size, the
 * WARNING label names the GAME's cap (that is what makes it actionable).
 *
 * @param onlineMax RAW `cooptimusOnlineMax` from the entry / match DTO.
 * @param groupSize Voting phase → `votingEligibleCount`; decided matches →
 *   the LIVE `match.members.length`, recomputed on every render.
 */
export function coopFitLabel(
    onlineMax: number | null | undefined,
    groupSize: number,
): { fits: boolean; label: string } | null {
    if (onlineMax == null || onlineMax <= 0) return null;
    if (groupSize <= 0) return null;
    return onlineMax >= groupSize
        ? { fits: true, label: `✓ fits ${groupSize}` }
        : { fits: false, label: `⚠ ${onlineMax}-player co-op` };
}

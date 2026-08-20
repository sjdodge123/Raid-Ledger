/**
 * Co-op capacity hints for nomination surfaces (ROK-1400).
 *
 * Mirrors the API's `resolvePlayerCap` (ROK-1411) so the badge a user sees
 * in the NominateModal agrees with the `minOnlineCoop` filter the Common
 * Ground picker applies server-side. Advisory only — nothing here blocks a
 * nomination (operator decision: soft filter, no hard gate).
 */
import type { JSX } from 'react';

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

/**
 * Badge with the effective co-op capacity plus a soft warning when the game
 * looks too small for the group. Renders nothing when the game has no co-op
 * data — an absent badge is the honest signal, an invented number is not.
 */
export function CoopFitHints({
    game,
    participantCount,
}: {
    game: CoopCapacityFields;
    participantCount?: number;
}): JSX.Element | null {
    const max = resolveEffectiveOnlineMax(
        game.cooptimusOnlineMax,
        game.playerCount?.max,
    );
    if (max == null) return null;
    const tooSmall = participantCount != null && max < participantCount;
    return (
        <span className="flex items-center gap-2 shrink-0">
            <span
                data-testid="coop-max-badge"
                className="px-1.5 py-0.5 rounded bg-panel border border-edge text-[10px] text-muted whitespace-nowrap"
            >
                Up to {max} online
            </span>
            {tooSmall && (
                <span className="text-[10px] text-amber-400 whitespace-nowrap">
                    May not fit your group of {participantCount}
                </span>
            )}
        </span>
    );
}

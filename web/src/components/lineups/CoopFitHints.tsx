/**
 * Co-op capacity badge + soft group-size warning (ROK-1400). Rendered on
 * nomination search results. Purely advisory — it never disables a row and
 * never blocks a nomination (operator decision: soft filter, no hard gate).
 */
import type { JSX } from 'react';
import { resolveEffectiveOnlineMax, type CoopCapacityFields } from './coop-fit';

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
                {/* A synced zero is "no online co-op", not a capacity of 0 —
                    "Up to 0 online" would read as a data glitch. */}
                {max === 0 ? 'No online co-op' : `Up to ${max} online`}
            </span>
            {tooSmall && (
                <span className="text-[10px] text-amber-400 whitespace-nowrap">
                    May not fit your group of {participantCount}
                </span>
            )}
        </span>
    );
}

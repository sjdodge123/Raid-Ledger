/**
 * Co-op capacity badge + soft group-size warning (ROK-1400). Rendered on
 * nomination search results. Purely advisory — it never disables a row and
 * never blocks a nomination (operator decision: soft filter, no hard gate).
 */
import type { JSX } from 'react';
import { resolveEffectiveOnlineMax, type CoopCapacityFields } from './coop-fit';
import { coopLabel } from '../../lib/coop-label';

/**
 * Badge with the game's co-op claim plus a soft warning when it looks too
 * small for the group. Renders nothing when the game has no co-op data — an
 * absent badge is the honest signal, an invented number is not.
 *
 * ROK-1401 round 3: the badge copy now comes from the shared `coopLabel`
 * helper, so this row speaks the same `combo` / `online` / `local` vocabulary
 * as the games-page card badge and the Common Ground pill.
 *
 * ROK-1400's synced-ZERO state is deliberately KEPT: a game whose sync ran
 * and found no online co-op has no `coopLabel` to show, but "No online co-op"
 * is a real, operator-ratified signal here (and it is what drives the
 * group-size warning), so it is not the same as never-synced silence.
 */
export function CoopFitHints({
    game,
    participantCount,
}: {
    game: CoopCapacityFields;
    participantCount?: number;
}): JSX.Element | null {
    const coop = coopLabel({
        online: game.cooptimusOnlineMax,
        couch: game.cooptimusCouchMax,
        combo: game.cooptimusComboCoop,
    });
    const max = resolveEffectiveOnlineMax(game.cooptimusOnlineMax);
    if (coop == null && max == null) return null;
    // The warning is about whether the GROUP can play together, which is an
    // ONLINE question — so it keys off the online max, never off the label's
    // count. A local-only game can carry a big couch number (couch 8) while
    // having zero online co-op; comparing 8 against a group of 6 would drop
    // the warning for a game the group literally cannot play together
    // remotely. ROK-1400 shipped this warning on the online max; round 3's
    // label rework must not change it.
    const tooSmall =
        participantCount != null && max != null && max < participantCount;
    return (
        <span className="flex items-center gap-2 shrink-0">
            <span
                data-testid="coop-max-badge"
                className="px-1.5 py-0.5 rounded bg-panel border border-edge text-[10px] text-muted whitespace-nowrap"
            >
                {/* A synced zero is "no online co-op", not a capacity of 0 —
                    "Up to 0 online" would read as a data glitch. */}
                {coop ? coop.label : 'No online co-op'}
            </span>
            {tooSmall && (
                <span className="text-[10px] text-amber-400 whitespace-nowrap">
                    May not fit your group of {participantCount}
                </span>
            )}
        </span>
    );
}

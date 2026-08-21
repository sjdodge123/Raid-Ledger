/**
 * Co-op capability pill (ROK-1401) — shared by the lineup pill rows:
 * `CommonGroundGameCard` (nominate tiles) and `AiSuggestionCard`. Sized to
 * match the violet players pill it sits beside, in a distinct teal fill.
 *
 * Copy and gating come from the shared `coopLabel` helper (round 3) so this
 * pill, the games-page card badge and the NominateModal row all speak the
 * same three-label vocabulary — `combo` / `online` / `local` co-op — and one
 * card never shows two of them.
 *
 * **Strictly Co-Optimus-verified.** A synced `0`, a never-synced `null`, and
 * the `undefined` of a stale cached row all mean "no claim", and a couch max
 * of 1 is not local co-op. Any of those render NOTHING — no element with the
 * `coop-pill` testid, no placeholder, no layout hole — so a pre-activation
 * surface is pixel-identical to before. IGDB `playerCount` is never a
 * fallback: a lobby size is not a co-op capability (PUBG is not 100-player
 * co-op).
 *
 * Carries no attribution credit — `/games/:id` is the credited surface
 * (ROK-1398/1399), the same division the game-card badge settled on.
 */
import type { JSX } from 'react';
import { coopLabel, coopAriaLabel } from '../../lib/coop-label';

export interface CoopPillProps {
    /** RAW `cooptimusOnlineMax` from the row / suggestion DTO. */
    cooptimusOnlineMax: number | null | undefined;
    /** RAW `cooptimusCouchMax` — promotes a couch-only game to `local`. */
    cooptimusCouchMax?: number | null;
    /** RAW `cooptimusComboCoop` — Co-Optimus's Local + Online flag. */
    cooptimusComboCoop?: boolean | null;
    /** Extra positioning classes for the host pill row. */
    className?: string;
}

export function CoopPill({
    cooptimusOnlineMax,
    cooptimusCouchMax,
    cooptimusComboCoop,
    className = '',
}: CoopPillProps): JSX.Element | null {
    const resolved = coopLabel({
        online: cooptimusOnlineMax,
        couch: cooptimusCouchMax,
        combo: cooptimusComboCoop,
    });
    if (!resolved) return null;
    return (
        <span
            data-testid="coop-pill"
            role="img"
            aria-label={coopAriaLabel(resolved)}
            className={`${className} px-1.5 py-0.5 text-[10px] font-bold rounded bg-teal-500/90 text-white whitespace-nowrap`}
        >
            {resolved.label}
        </span>
    );
}

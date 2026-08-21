/**
 * Compact co-op fit badge (ROK-1401) — shared by the Sv VotingRow and the
 * Decided MatchCard so the copy lives in exactly one place.
 *
 * Renders NOTHING when `coopFitLabel` returns null (never-synced, synced-zero,
 * or an unevaluable group size). That is the operator's dormancy requirement:
 * pre-activation these surfaces must be pixel-identical to before — no
 * placeholder element, no reserved space.
 *
 * Carries NO Co-Optimus attribution credit. The credited surface is
 * `/games/:id` (ROK-1398/1399), one tap away via the cover thumbnail.
 */
import type { JSX } from 'react';
import { coopFitLabel } from './coop-fit';

export interface CoopFitBadgeProps {
    /** RAW `cooptimusOnlineMax` from the entry / match DTO. */
    onlineMax: number | null | undefined;
    /** Voting: `votingEligibleCount`. Decided: live `members.length`. */
    groupSize: number;
    /** Extra positioning classes for the host surface. */
    className?: string;
}

export function CoopFitBadge({
    onlineMax,
    groupSize,
    className = '',
}: CoopFitBadgeProps): JSX.Element | null {
    const fit = coopFitLabel(onlineMax, groupSize);
    if (!fit) return null;
    return (
        <span
            data-testid="coop-fit-badge"
            data-fits={fit.fits ? 'true' : 'false'}
            className={`${className} flex-shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap ${
                fit.fits
                    ? 'bg-emerald-600/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-amber-600/15 text-amber-300 border border-amber-500/30'
            }`}
        >
            {fit.label}
        </span>
    );
}

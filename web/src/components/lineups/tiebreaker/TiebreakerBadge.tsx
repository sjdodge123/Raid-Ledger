/**
 * TiebreakerBadge (ROK-938).
 * "Tiebreaker active" badge for the Games page banner.
 */
import type { JSX } from 'react';

export function TiebreakerBadge(): JSX.Element {
    return (
        <span
            data-testid="tiebreaker-badge"
            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30"
        >
            Tiebreaker active
        </span>
    );
}

/**
 * Dismissible `Looking to play` filter chip for the games page (ROK-1453 AC3).
 *
 * The events banner links here with `?lfg=1`; without a visible affordance the
 * Library would silently look half-empty. Mirrors the events page's
 * `GenreFilterChip` (`events-page.tsx:214-229`) exactly — same `mb-4` wrapper,
 * same `inline-flex … px-3 py-1.5 rounded-full` pill, same 44px clear-button
 * target — in the amber the LFG surfaces use. It already sits inside the
 * page's centred container, so it takes no horizontal margin.
 */
import type { JSX } from 'react';
import { useLfgFilterParam } from './use-lfg-filter-param';

/** Renders only while the `lfg=1` filter is active. */
export function LfgFilterChip(): JSX.Element | null {
    const { isLfgOnly, clearLfgFilter } = useLfgFilterParam();

    if (!isLfgOnly) return null;

    return (
        <div className="mb-4 flex items-center gap-2">
            <span
                data-testid="lfg-filter-chip"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium bg-amber-500/10 border border-amber-500/30 text-amber-300"
            >
                🎯 Players are looking
                <button
                    type="button"
                    aria-label="Clear looking-to-play filter"
                    onClick={clearLfgFilter}
                    className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-3 rounded-full text-amber-300/80 hover:bg-amber-500/30 hover:text-amber-200 transition-colors"
                >
                    ✕
                </button>
            </span>
        </div>
    );
}

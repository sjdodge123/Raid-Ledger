/**
 * The `Players are looking` filter toggle on the games page (ROK-1478 AC1).
 *
 * ROK-1453 shipped this as a DISMISSIBLE chip: it rendered only while `?lfg=1`
 * was already in the URL, so the events banner was the single way into the
 * filtered view and there was no affordance at all to turn it on from the
 * Library. It is now a two-way control that is always present (spec D1) — the
 * ✕ button is absorbed, because pressing an ON toggle is exactly what the ✕
 * did.
 *
 * The pill geometry (`inline-flex … px-3 py-1.5 rounded-full`), the `mb-4`
 * wrapper and the amber ON tokens are carried over unchanged from the chip it
 * replaces; only the OFF state is new, and it borrows the muted token
 * `DesktopGenrePills` already uses one file away (`games-page.tsx:214`). The
 * 44px minimum target moves from the ✕ onto the toggle itself.
 *
 * `data-testid="lfg-filter-chip"` is deliberately kept: `lfg-chips.smoke.spec.ts`
 * pins it, and renaming a live selector to suit a refactor is a silent
 * weakening of that spec.
 */
import type { JSX } from 'react';
import { useLfgFilterParam } from './use-lfg-filter-param';

const BASE_CLS =
    'inline-flex items-center gap-2 px-3 py-1.5 min-h-[44px] rounded-full text-sm font-medium transition-colors';

const ON_CLS =
    'bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20';

const OFF_CLS =
    'bg-panel border border-edge text-secondary hover:bg-overlay';

/**
 * A pressed/unpressed toggle for the `lfg=1` Library filter.
 *
 * Always rendered, and never disabled: an empty community is precisely when a
 * player needs to look, and the grid behind the filter has its own empty state
 * (`lfg-looking-grid.tsx:52-61`, AC2).
 */
export function LfgFilterChip(): JSX.Element {
    const { isLfgOnly, toggleLfgFilter } = useLfgFilterParam();

    return (
        <div className="mb-4 flex items-center gap-2">
            <button
                type="button"
                data-testid="lfg-filter-chip"
                aria-pressed={isLfgOnly}
                onClick={toggleLfgFilter}
                className={`${BASE_CLS} ${isLfgOnly ? ON_CLS : OFF_CLS}`}
            >
                🎯 Players are looking
            </button>
        </div>
    );
}

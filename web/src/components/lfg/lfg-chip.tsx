/**
 * The LFG tile chip (ROK-1453 AC1/AC2/AC4).
 *
 * Rendered on game tiles and on the game-detail meta row. Two states:
 *   • `lfm` (2+ looking) — emerald solid, the "join them" case;
 *   • `lfg` (1 looking) — amber-300 tonal, the "they need you" case.
 *
 * It is a `<button role="link">`, not an `<a>`: `CardBadgeRow` renders inside
 * the tile's own `<Link>` and an anchor inside an anchor is invalid HTML
 * (spec decision D5). The click both stops propagating (so the tile link does
 * not also fire) and navigates to the LFG page for the game.
 *
 * The visible copy is the source of truth for the count (D9) — no count
 * attribute — and the `aria-label` repeats it verbatim so screen-reader users
 * hear the same sentence sighted users read.
 */
import type { JSX, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LfgState } from '@raid-ledger/contract';

/** Assumed group size when a game has no Co-Optimus data: two players. */
const DEFAULT_VIABILITY_THRESHOLD = 2;

const CHIP_CLS =
    'px-2 py-0.5 text-xs font-bold rounded transition-opacity hover:opacity-90';

const STATE_CLS: Record<'lfg' | 'lfm', string> = {
    lfm: 'bg-emerald-500/90 text-white',
    lfg: 'bg-amber-300/95 text-amber-950',
};

export interface LfgChipProps {
    /** Eligible active intents. Nothing renders at 0 or `undefined` (AC4). */
    activeCount?: number | null;
    /** `games.cooptimusOnlineMax`, when Co-Optimus knows the group size. */
    viabilityThreshold?: number | null;
    /** Server-derived state; falls back to the count when absent. */
    state?: LfgState;
    /** `games.slug` — the chip navigates to `/lfg/{gameSlug}`. */
    gameSlug: string;
}

/**
 * How many more players the group still needs — never fewer than one, so a
 * single-player group never reads "needs 0 more".
 */
function playersStillNeeded(
    activeCount: number,
    viabilityThreshold?: number | null,
): number {
    const target = viabilityThreshold ?? DEFAULT_VIABILITY_THRESHOLD;
    return Math.max(1, target - activeCount);
}

/** The one sentence the chip shows, labels itself with, and is asserted on. */
function chipLabel(
    activeCount: number,
    state: 'lfg' | 'lfm',
    viabilityThreshold?: number | null,
): string {
    if (state === 'lfm') return `🎯 ${activeCount} looking to play`;
    const needed = playersStillNeeded(activeCount, viabilityThreshold);
    return `🎯 ${activeCount} looking · needs ${needed} more`;
}

/** A chip linking to the game's LFG group. Renders nothing when nobody looks. */
export function LfgChip({
    activeCount,
    viabilityThreshold,
    state,
    gameSlug,
}: LfgChipProps): JSX.Element | null {
    const navigate = useNavigate();

    if (!activeCount || activeCount < 1) return null;

    const effectiveState: 'lfg' | 'lfm' =
        state ?? (activeCount >= 2 ? 'lfm' : 'lfg');
    const label = chipLabel(activeCount, effectiveState, viabilityThreshold);

    // The tile is itself a link — keep the click off it (D5).
    const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        navigate(`/lfg/${gameSlug}`);
    };

    return (
        <button
            type="button"
            role="link"
            data-testid="lfg-chip"
            data-lfg-state={effectiveState}
            aria-label={label}
            onClick={handleClick}
            className={`${CHIP_CLS} ${STATE_CLS[effectiveState]}`}
        >
            {label}
        </button>
    );
}

/**
 * The LFG tile chip (ROK-1453 AC1/AC2/AC4).
 *
 * Rendered on game tiles and on the game-detail meta row. Two states:
 *   • `lfm` (2+ looking) — emerald solid, the "join them" case;
 *   • `lfg` (1 looking) — amber-300 tonal, the "they need you" case.
 *
 * ROK-1478 AC4 made it a real `<a href="/lfg/{gameSlug}">`. The original
 * reason for a `<button role="link">` — "the chip renders inside the tile's own
 * `<Link>`" — has not been true since `UnifiedGameCard` started rendering
 * `CardLfgChip` as a SIBLING of that anchor (`unified-game-card.tsx:116`), and
 * the other placement (`GameBanner.tsx:95`) is inside a plain `<div>`. An href
 * is what lets middle-click, copy-link and "open in new tab" work at all, and
 * it is what makes "clicking the badge does not open the game details" an
 * assertion about the markup rather than about a side effect.
 *
 * `role="link"` is kept explicitly (a shipped a11y assertion pins it) and the
 * click still stops propagating so an enclosing tile handler never also fires.
 * `preventDefault()` is NOT kept — it would cancel the anchor's own navigation.
 *
 * The visible copy is the source of truth for the count (D9) — no count
 * attribute — and the `aria-label` repeats it verbatim so screen-reader users
 * hear the same sentence sighted users read.
 */
import type { JSX, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import type { LfgState } from '@raid-ledger/contract';
import { chipLabel, effectiveLfgState } from './lfg-chip-copy';

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
    /**
     * How many of {@link activeCount} want to play RIGHT NOW (ROK-1479 A6).
     * Above zero the chip shows the now line INSTEAD of the weekly one and
     * carries `data-lfg-now`; at zero or absent the chip is unchanged.
     */
    nowCount?: number | null;
    /** `games.slug` — the chip navigates to `/lfg/{gameSlug}`. */
    gameSlug: string;
}

/**
 * The card around the badge may carry its own handler — keep the click off it.
 * No `preventDefault`: the anchor's own navigation is the point. Hoisted out
 * of the component because it closes over nothing.
 *
 * @param event - The chip's own click.
 */
function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    event.stopPropagation();
}

/**
 * `data-lfg-now`, or nothing at all when nobody wants to play right now.
 *
 * Absent rather than `"0"`: a selector asks whether the attribute EXISTS, and
 * `data-lfg-now="0"` would answer yes to a question about urgency.
 *
 * @param nowCount - Live `now` intents on the game.
 */
function nowAttr(nowCount?: number | null): string | undefined {
    return nowCount != null && nowCount > 0 ? String(nowCount) : undefined;
}

/**
 * The rendered chip. Split from `LfgChip` so the router is only reached when
 * there IS a chip: tiles render on surfaces (onboarding, plain component tests)
 * that mount no `<Router>`, and an unconditional `<Link>` would throw there
 * even though the chip itself is absent.
 */
function LfgChipButton({
    activeCount,
    viabilityThreshold,
    state,
    nowCount,
    gameSlug,
}: LfgChipProps & { activeCount: number }): JSX.Element {
    const effectiveState = effectiveLfgState(activeCount, state);
    const label = chipLabel(
        activeCount,
        effectiveState,
        viabilityThreshold,
        nowCount,
    );

    return (
        <Link
            to={`/lfg/${gameSlug}`}
            role="link"
            data-testid="lfg-chip"
            data-lfg-state={effectiveState}
            data-lfg-now={nowAttr(nowCount)}
            aria-label={label}
            onClick={handleClick}
            className={`${CHIP_CLS} ${STATE_CLS[effectiveState]}`}
        >
            {label}
        </Link>
    );
}

/** A chip linking to the game's LFG group. Renders nothing when nobody looks. */
export function LfgChip(props: LfgChipProps): JSX.Element | null {
    const { activeCount } = props;
    if (!activeCount || activeCount < 1) return null;
    return <LfgChipButton {...props} activeCount={activeCount} />;
}

import type { JSX } from 'react';
import { FULL_DAYS } from '../game-time-grid.utils';
import { dayFreeLabel } from './phone-week.utils';

interface DayPagerProps {
    /** Day on screen, grid convention (0 = Sunday). */
    day: number;
    freeHours: number;
    /**
     * Replaces the free-hour count under the day name. GROUP mode (ROK-1580)
     * puts the date and the poll size there — "Sep 16 · 4 in poll" — because
     * the viewer's own free hours are not what that screen is about.
     */
    subtitle?: string;
    /**
     * Paging past an end is a week step rather than a dead end (ROK-1580): the
     * caller re-fetches the neighbouring week, so both arrows stay live.
     */
    canWrap?: boolean;
    onPrev: () => void;
    onNext: () => void;
}

/**
 * `‹ Tuesday · 3h free ›` — the phone editor's day header (ROK-1569).
 *
 * The arrows are 44px targets and the week does not wrap: the arrow that would
 * run off the end is disabled rather than silently doing nothing, so the edges
 * of the week are visible instead of being discovered by tapping.
 */
export function DayPager({
    day, freeHours, subtitle, canWrap = false, onPrev, onNext,
}: DayPagerProps): JSX.Element {
    return (
        <div className="flex flex-none items-center justify-between gap-2 py-1" data-testid="phone-day-pager">
            <ArrowButton label="Previous day" glyph="‹" onClick={onPrev} disabled={!canWrap && day <= 0} />
            <div className="min-w-0 text-center">
                <div className="truncate text-base font-semibold text-foreground" data-testid="phone-day-title">
                    {FULL_DAYS[day]}
                </div>
                <div className="text-xs text-dim" data-testid="phone-day-free">{subtitle ?? dayFreeLabel(freeHours)}</div>
            </div>
            <ArrowButton label="Next day" glyph="›" onClick={onNext} disabled={!canWrap && day >= 6} />
        </div>
    );
}

/** One 44px paging arrow. */
function ArrowButton({ label, glyph, onClick, disabled }: {
    label: string; glyph: string; onClick: () => void; disabled: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className="min-h-[44px] min-w-[44px] rounded-lg border border-edge bg-panel text-lg text-foreground
                disabled:opacity-40 disabled:cursor-not-allowed hover:border-emerald-500/60"
        >
            {glyph}
        </button>
    );
}

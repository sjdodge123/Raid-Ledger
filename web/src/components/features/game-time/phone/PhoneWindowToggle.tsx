import type { JSX } from 'react';
import { formatHour } from '../game-time-grid.utils';

interface PhoneWindowToggleProps {
    /** The full range; its head is what the window hides. */
    allHours: number[];
    /** How many of those the window currently hides. */
    hiddenEarlier: number;
    expanded: boolean;
    onToggle: () => void;
}

/**
 * "Show earlier" — the one tap that adds the morning back (ROK-1579 frame 3).
 *
 * Deliberately quiet: a 30px dashed row, muted text, no accent. It is an
 * affordance for the minority who play before mid-afternoon, not an action.
 * Every colour is a token; it renders only when something IS hidden.
 */
export function PhoneWindowToggle({
    allHours, hiddenEarlier, expanded, onToggle,
}: PhoneWindowToggleProps): JSX.Element | null {
    if (hiddenEarlier <= 0) return null;
    const range = `${formatHour(allHours[0])}–${formatHour(allHours[hiddenEarlier])}`;
    return (
        <button
            type="button"
            data-testid="phone-week-show-earlier"
            aria-expanded={expanded}
            onClick={onToggle}
            className={`flex h-[30px] w-full flex-none items-center justify-center gap-1.5 rounded-lg border
                border-dashed border-edge text-[11px] font-medium text-muted transition-colors hover:text-foreground
                ${expanded ? 'border-solid text-foreground' : ''}`}
        >
            {expanded ? '▴ Hide earlier' : `▾ Show earlier (${range})`}
        </button>
    );
}

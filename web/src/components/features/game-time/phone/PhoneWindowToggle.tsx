import type { JSX } from 'react';
import { formatHour } from '../game-time-grid.utils';
import type { WindowBand } from './use-profile-window';

interface PhoneWindowToggleProps {
    /** `earlier` renders above the day, `later` below it. */
    direction: 'earlier' | 'later';
    /** The band this row opens (`useProfileWindow().earlier` / `.later`). */
    band: WindowBand;
    /** Test-id prefix per mount: `phone-week` (drawer, default) / `desktop-week` (profile grid). */
    testIdPrefix?: string;
}

/** "6 AM – 6 PM" / "1 AM – 6 AM" — the band's span, end exclusive. */
function bandRange(hours: number[]): string {
    return `${formatHour(hours[0])} – ${formatHour((hours[hours.length - 1] + 1) % 24)}`;
}

/**
 * "Show earlier" / "Show later" — the taps that reach the rest of the day
 * (ROK-1579 frame 3, both ways since ROK-1584 §3).
 *
 * Deliberately quiet: a 30px dashed row, muted text, no accent. It is an
 * affordance for the minority who play outside the evening, not an action.
 * Every colour is a token; it renders only when the band IS holding hours back.
 */
export function PhoneWindowToggle({ direction, band, testIdPrefix = 'phone-week' }: PhoneWindowToggleProps): JSX.Element | null {
    if (band.hidden <= 0 || band.hours.length === 0) return null;
    const isEarlier = direction === 'earlier';
    const caret = isEarlier ? '▴' : '▾';
    const noun = isEarlier ? 'earlier' : 'later';
    return (
        <button
            type="button"
            data-testid={`${testIdPrefix}-show-${noun}`}
            aria-expanded={band.expanded}
            onClick={band.toggle}
            className={`flex h-[30px] w-full flex-none items-center justify-center gap-1.5 rounded-lg border
                border-dashed border-edge text-[11px] font-medium text-muted transition-colors hover:text-foreground
                ${band.expanded ? 'border-solid text-foreground' : ''}`}
        >
            {band.expanded ? `${caret} Hide ${noun}` : `${caret} Show ${noun} (${bandRange(band.hours)})`}
        </button>
    );
}

import type { JSX } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import type { WeekHoursBand } from './use-week-hours';
import { weekRangeLabel } from './week-label';

export interface GroupWeekToolbarProps {
    weekStart: Date;
    onWeekChange: (delta: -1 | 1) => void;
    earlier: WeekHoursBand;
    later: WeekHoursBand;
}

const ARROW = 'flex h-11 w-11 items-center justify-center rounded-lg border border-edge text-muted '
    + 'transition-colors hover:text-foreground';
const TOGGLE = 'h-11 rounded-lg border border-edge px-3 text-sm text-muted transition-colors hover:text-foreground';

/** "▴ Show earlier" / "▾ Show later" — `aria-expanded` mirrors the band. */
function BandToggle({ band, testId }: { band: WeekHoursBand; testId: string }): JSX.Element {
    return (
        <button type="button" data-testid={testId} aria-expanded={band.open} onClick={band.toggle} className={TOGGLE}>
            {band.label}
        </button>
    );
}

/**
 * The week view's header bar (ROK-1588): previous / next week around the range
 * label, then the two hour-band toggles right-aligned.
 */
export function GroupWeekToolbar({ weekStart, onWeekChange, earlier, later }: GroupWeekToolbarProps): JSX.Element {
    return (
        <div className="flex items-center gap-2" data-testid="group-week-toolbar">
            <button type="button" aria-label="Previous week" onClick={() => onWeekChange(-1)} className={ARROW}>
                <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <b className="min-w-[7.5rem] text-center text-sm font-semibold text-foreground">{weekRangeLabel(weekStart)}</b>
            <button type="button" aria-label="Next week" onClick={() => onWeekChange(1)} className={ARROW}>
                <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="flex-1" />
            <BandToggle band={earlier} testId="group-week-show-earlier" />
            <BandToggle band={later} testId="group-week-show-later" />
        </div>
    );
}

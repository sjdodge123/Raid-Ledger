import { useState } from 'react';
import { CHECK_HOURS } from '../phone/phone-week-check.helpers';
import { EARLIER_HOURS, LATER_HOURS } from '../phone/phone-window.helpers';

/** One collapsible band of hours around the evening window. */
export interface WeekHoursBand {
    open: boolean;
    toggle: () => void;
    label: string;
}

export interface WeekHours {
    /** Visible hours in display order: earlier, base, later (6 AM → 5 AM). */
    hours: number[];
    earlier: WeekHoursBand;
    later: WeekHoursBand;
}

/** 6 AM – 4 PM: the phone's earlier band minus what the base window already shows. */
const EARLIER_BAND: number[] = EARLIER_HOURS.filter((h) => !CHECK_HOURS.includes(h));

/** 12 AM – 5 AM. */
const LATER_BAND: number[] = [0, ...LATER_HOURS];

/**
 * One band's open state: auto-open while a required hour lies inside it, until
 * the viewer toggles it explicitly (the override then wins; not persisted).
 */
function useBand(band: number[], required: { hour: number }[], arrow: string, noun: string): WeekHoursBand {
    const [override, setOverride] = useState<boolean | null>(null);
    const needed = required.some((r) => band.includes(r.hour));
    const open = override ?? needed;
    return {
        open,
        toggle: () => setOverride(!open),
        label: `${arrow} ${open ? 'Hide' : 'Show'} ${noun}`,
    };
}

/**
 * The desktop week view's visible hours (ROK-1588, Q10): `CHECK_HOURS`
 * (5 PM – 11 PM) by default, with "Show earlier" / "Show later" bands that open
 * on their own when a poll slot, pick or current start needs an hour in them.
 *
 * @param required Hours that must be visible — every slot mark, pick and current.
 */
export function useWeekHours(required: { hour: number }[]): WeekHours {
    const earlier = useBand(EARLIER_BAND, required, '▴', 'earlier');
    const later = useBand(LATER_BAND, required, '▾', 'later');
    const hours = [
        ...(earlier.open ? EARLIER_BAND : []),
        ...CHECK_HOURS,
        ...(later.open ? LATER_BAND : []),
    ];
    return { hours, earlier, later };
}

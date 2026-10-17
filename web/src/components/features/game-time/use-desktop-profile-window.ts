/**
 * The desktop profile grid's hour window (ROK-1585 AC4a).
 *
 * Same three bands as the phone drawer (`phone/phone-window.helpers.ts`) and
 * the same remembered choice (`rl.gameTime.profileWindow`, shared per device),
 * but no fit: the desktop grid has room for every row, so the default is
 * simply the evening, 6 PM – 1 AM, and each toggle adds its whole band.
 */
import { useMemo } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { EARLIER_HOURS, LATER_HOURS, desktopHourRange, hasClaimedHourIn } from './phone/phone-window.helpers';
import { useWindowBand, type WindowBand } from './phone/use-profile-window';

export interface DesktopProfileWindow {
    /** `GameTimeGrid`'s `hourRange` for the open bands. */
    hourRange: [number, number];
    /** "▴ Show earlier (6 AM – 6 PM)", rendered above the grid. */
    earlier: WindowBand;
    /** "▾ Show later (1 AM – 6 AM)", rendered below the grid. */
    later: WindowBand;
}

/**
 * Which hours the desktop profile grid shows and the two toggles that change it.
 * A band auto-opens when the week claims an hour inside it; an explicit toggle
 * outranks that from then on.
 *
 * @param slots The week on screen (draft or saved).
 */
export function useDesktopProfileWindow(slots: GameTimeSlot[]): DesktopProfileWindow {
    const [showEarlier, toggleEarlier] = useWindowBand('earlier', hasClaimedHourIn(slots, EARLIER_HOURS));
    const [showLater, toggleLater] = useWindowBand('later', hasClaimedHourIn(slots, LATER_HOURS));
    return useMemo(() => ({
        hourRange: desktopHourRange({ earlier: showEarlier, later: showLater }),
        // Nothing is fitted away on desktop, so each toggle always holds its whole band.
        earlier: { hours: EARLIER_HOURS, hidden: EARLIER_HOURS.length, expanded: showEarlier, toggle: toggleEarlier },
        later: { hours: LATER_HOURS, hidden: LATER_HOURS.length, expanded: showLater, toggle: toggleLater },
    }), [showEarlier, toggleEarlier, showLater, toggleLater]);
}

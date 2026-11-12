/**
 * ROK-2176: while one of our item popups is open, a Wowhead hover tooltip
 * must not float above it (tooltips.js binds every wowhead.com link, with or
 * without `data-wowhead`, so a card under the popup can still spawn one).
 * The popup sets this body attribute and `wow-item-card.css` hides
 * `.wowhead-tooltip` under it. Counted, so a popup over a popup is safe.
 */
import { useEffect } from 'react';

export const WOW_POPUP_OPEN_ATTR = 'data-wow-popup-open';

let openCount = 0;

export function useHideWowheadTooltips(active: boolean): void {
    useEffect(() => {
        if (!active) return undefined;
        openCount += 1;
        document.body.setAttribute(WOW_POPUP_OPEN_ATTR, '');
        return () => {
            openCount = Math.max(0, openCount - 1);
            if (openCount === 0) document.body.removeAttribute(WOW_POPUP_OPEN_ATTR);
        };
    }, [active]);
}

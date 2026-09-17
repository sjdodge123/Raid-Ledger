/**
 * The profile drawer's hour window, measured (ROK-1579 frame 3 → ROK-1584 §3).
 *
 * The default window is "as many 44px rows as fit the day slot, taken from the
 * end of the 6 AM–1 AM head" — so it always ends at 1 AM and the evening is on
 * screen with no scroll. Two bands reach the rest of the day: "Show earlier"
 * (6 AM – 6 PM) above it and "Show later" (1 AM – 6 AM) below it.
 *
 * The slot's height is only known after layout and changes with the sheet (the
 * absence panel opening, a rotate), so this is a ResizeObserver, the same shape
 * `DayBlockEditor::useMeasuredDims` uses for the row height.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import {
    hasClaimedHourIn, hasHourOutsideWindow, profileWindowHours,
    readProfileWindow, writeProfileWindow, splitHourRange,
} from './phone-window.helpers';

/** One expandable band of the day, and the toggle that opens it. */
export interface WindowBand {
    /** The hours the band owns — the toggle names their range. */
    hours: number[];
    /** How many hours it is holding back; 0 means no toggle. */
    hidden: number;
    /** Whether the band is currently open. */
    expanded: boolean;
    /** The toggle: an EXPLICIT choice, remembered from here on. */
    toggle: () => void;
}

export interface ProfileWindow {
    /** Attach to the day slot — the box whose height decides the window. */
    slotRef: React.RefObject<HTMLDivElement | null>;
    /** The hours to render. */
    hours: number[];
    /** The morning band, rendered above the day. */
    earlier: WindowBand;
    /** The small-hours band, rendered below the day. */
    later: WindowBand;
    /** Open the morning without recording a preference (a preset needed the room). */
    expand: () => void;
}

/** Measured height of the day slot, unless a caller pre-measured it (tests). */
function useSlotHeight(slotRef: React.RefObject<HTMLDivElement | null>, override?: number): number {
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const el = slotRef.current;
        if (override !== undefined || !el || typeof ResizeObserver === 'undefined') return;
        // A display:none slot (the drawer's away view hides the editor, ROK-1585)
        // reads 0 — keep the last real height rather than collapsing the window.
        const measure = (): void => {
            const next = el.clientHeight;
            if (next > 0) setHeight((prev) => (prev === next ? prev : next));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [override, slotRef]);
    return override ?? height;
}

/** Keep the evening in view when the morning is added above it. */
function useScrollToBottomOnExpand(slotRef: React.RefObject<HTMLDivElement | null>, expanded: boolean): void {
    useEffect(() => {
        if (!expanded) return;
        const scroller = slotRef.current?.querySelector<HTMLElement>('[data-testid="phone-day-grid"]');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
    }, [expanded, slotRef]);
}

/**
 * One band's open/closed state: the stored tap if there is one, else whatever
 * the saved week asks for.
 *
 * @param key Which band, and therefore which stored flag.
 * @param auto Whether the saved week claims an hour inside the band.
 * @returns The band's `expanded`/`toggle` pair and a setter for callers that
 *   need the room without recording a preference.
 */
export function useWindowBand(
    key: 'earlier' | 'later', auto: boolean,
): [boolean, () => void, (next: boolean) => void] {
    const [choice, setChoice] = useState<boolean | null>(() => readProfileWindow()[key]);
    const expanded = choice ?? auto;
    const toggle = useCallback(() => {
        const next = !expanded;
        writeProfileWindow({ [key]: next });
        setChoice(next);
    }, [expanded, key]);
    return [expanded, toggle, setChoice];
}

/**
 * Decide which hours the drawer shows and how the viewer changes that.
 *
 * @param allHours The caller's full range (the profile's 24 hours from 6 AM).
 * @param slots The week on screen — a saved hour in a band auto-opens it.
 * @param heightOverride Pre-measured slot height for tests (jsdom is zero-sized).
 */
export function useProfileWindow(
    allHours: number[], slots: GameTimeSlot[], heightOverride?: number,
): ProfileWindow {
    const slotRef = useRef<HTMLDivElement | null>(null);
    const height = useSlotHeight(slotRef, heightOverride);
    const segments = useMemo(() => splitHourRange(allHours), [allHours]);
    // The fully collapsed window is what both bands measure themselves against.
    const fit = useMemo(
        () => profileWindowHours(allHours, height, { earlier: false, later: false }),
        [allHours, height],
    );
    const head = useMemo(() => [...segments.earlier, ...segments.base], [segments]);
    const autoEarlier = fit.hiddenEarlier > 0 && hasHourOutsideWindow(slots, fit.hours, head);
    const [showEarlier, toggleEarlier, setEarlier] = useWindowBand('earlier', autoEarlier);
    const [showLater, toggleLater] = useWindowBand('later', hasClaimedHourIn(slots, segments.later));

    const win = useMemo(
        () => profileWindowHours(allHours, height, { earlier: showEarlier, later: showLater }),
        [allHours, height, showEarlier, showLater],
    );
    useScrollToBottomOnExpand(slotRef, showEarlier);
    const expand = useCallback(() => setEarlier(true), [setEarlier]);

    return useMemo(() => ({
        slotRef,
        hours: win.hours,
        earlier: { hours: segments.earlier, hidden: win.hiddenEarlier, expanded: showEarlier, toggle: toggleEarlier },
        later: { hours: segments.later, hidden: win.hiddenLater, expanded: showLater, toggle: toggleLater },
        expand,
    }), [win, segments, showEarlier, toggleEarlier, showLater, toggleLater, expand]);
}

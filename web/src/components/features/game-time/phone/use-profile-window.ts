/**
 * The profile drawer's hour window, measured (ROK-1579, approved frame 3).
 *
 * The window is "as many 44px rows as fit the day slot, taken from the end of
 * the range" — so it always ends at 1 AM and the evening is on screen with no
 * scroll. The slot's height is only known after layout and changes with the
 * sheet (the absence panel opening, a rotate), so this is a ResizeObserver, the
 * same shape `DayBlockEditor::useMeasuredDims` uses for the row height.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { fittedWindow, hasHourOutsideWindow, readProfileWindow, writeProfileWindow } from './phone-window.helpers';

export interface ProfileWindow {
    /** Attach to the day slot — the box whose height decides the window. */
    slotRef: React.RefObject<HTMLDivElement | null>;
    /** The hours to render. */
    hours: number[];
    /** How many earlier hours the fit hides; 0 means no toggle. */
    hiddenEarlier: number;
    /** Whether the earlier hours are currently shown. */
    expanded: boolean;
    /** The toggle: an EXPLICIT choice, remembered from here on. */
    toggle: () => void;
    /** Expand without recording a preference (a preset needed the room). */
    expand: () => void;
}

/** Measured height of the day slot, unless a caller pre-measured it (tests). */
function useSlotHeight(slotRef: React.RefObject<HTMLDivElement | null>, override?: number): number {
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const el = slotRef.current;
        if (override !== undefined || !el || typeof ResizeObserver === 'undefined') return;
        const measure = (): void => setHeight((prev) => (prev === el.clientHeight ? prev : el.clientHeight));
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
 * Decide which hours the drawer shows and how the viewer changes that.
 *
 * @param allHours The caller's full range (the profile's 9 AM–1 AM).
 * @param slots The week on screen — a saved hour outside the window auto-expands.
 * @param heightOverride Pre-measured slot height for tests (jsdom is zero-sized).
 */
export function useProfileWindow(
    allHours: number[], slots: GameTimeSlot[], heightOverride?: number,
): ProfileWindow {
    const slotRef = useRef<HTMLDivElement | null>(null);
    const height = useSlotHeight(slotRef, heightOverride);
    // `null` = never chosen, so auto-expand decides; a stored/tapped value wins.
    const [choice, setChoice] = useState<boolean | null>(() => readProfileWindow());

    const fit = useMemo(() => fittedWindow(allHours, height, false), [allHours, height]);
    const autoExpand = fit.hiddenEarlier > 0 && hasHourOutsideWindow(slots, fit.hours);
    const expanded = choice ?? autoExpand;
    const hours = useMemo(() => (expanded ? allHours : fit.hours), [expanded, allHours, fit.hours]);

    useScrollToBottomOnExpand(slotRef, expanded);

    const toggle = useCallback(() => {
        const next = !expanded;
        writeProfileWindow(next);
        setChoice(next);
    }, [expanded]);

    return { slotRef, hours, hiddenEarlier: fit.hiddenEarlier, expanded, toggle, expand: () => setChoice(true) };
}

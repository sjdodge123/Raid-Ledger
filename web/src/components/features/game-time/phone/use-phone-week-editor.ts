import { useCallback, useMemo, useRef, useState } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { clampDay, freeHourCount, swipeStep } from './phone-week.utils';

/** Pointer handlers that turn a horizontal drag on the editor into a day step. */
export interface SwipeHandlers {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
}

export interface PhoneWeekEditorApi {
    /** Day currently on screen, in the grid convention (0 = Sunday). */
    day: number;
    setDay: (day: number) => void;
    goPrev: () => void;
    goNext: () => void;
    /** Visible hours the viewer has marked free on `day`. */
    freeHours: number;
    swipeHandlers: SwipeHandlers;
}

/**
 * Day paging for the phone week editor (ROK-1569).
 *
 * Owns only which day is on screen — the slots themselves stay with the
 * caller, so this hook can be hoisted by a parent that needs to read or drive
 * the day (the poll's step 1 does).
 */
export function usePhoneWeekEditor(
    slots: GameTimeSlot[], hours: number[], initialDay = 0, onDayChange?: (day: number) => void,
): PhoneWeekEditorApi {
    const [day, setDayState] = useState(() => clampDay(initialDay));
    const origin = useRef<{ x: number; y: number } | null>(null);

    const setDay = useCallback((next: number) => {
        const clamped = clampDay(next);
        setDayState(clamped);
        onDayChange?.(clamped);
    }, [onDayChange]);

    const step = useCallback((delta: number) => setDay(day + delta), [day, setDay]);

    const swipeHandlers = useMemo<SwipeHandlers>(() => ({
        onPointerDown: (e) => { origin.current = { x: e.clientX, y: e.clientY }; },
        onPointerCancel: () => { origin.current = null; },
        onPointerUp: (e) => {
            const from = origin.current;
            origin.current = null;
            if (!from) return;
            const delta = swipeStep(e.clientX - from.x, e.clientY - from.y);
            if (delta !== 0) setDay(day + delta);
        },
    }), [day, setDay]);

    return {
        day,
        setDay,
        goPrev: () => step(-1),
        goNext: () => step(1),
        freeHours: freeHourCount(slots, day, hours),
        swipeHandlers,
    };
}

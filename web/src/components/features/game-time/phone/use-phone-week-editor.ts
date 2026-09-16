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
    onWeekStep?: (delta: -1 | 1) => void,
): PhoneWeekEditorApi {
    const [day, setDayState] = useState(() => clampDay(initialDay));
    const origin = useRef<{ x: number; y: number } | null>(null);

    const setDay = useCallback((next: number) => {
        const clamped = clampDay(next);
        setDayState(clamped);
        onDayChange?.(clamped);
    }, [onDayChange]);

    /**
     * Step a day — or, when the caller can move weeks (ROK-1580), off the end
     * of this one and onto the far end of the next. Without `onWeekStep` the
     * week still does not wrap: a template has no neighbouring week to show.
     */
    const step = useCallback((delta: number) => {
        const next = day + delta;
        if (onWeekStep && (next < 0 || next > 6)) {
            onWeekStep(next < 0 ? -1 : 1);
            setDay(next < 0 ? 6 : 0);
            return;
        }
        setDay(next);
    }, [day, setDay, onWeekStep]);

    const swipeHandlers = useMemo<SwipeHandlers>(() => ({
        onPointerDown: (e) => { origin.current = { x: e.clientX, y: e.clientY }; },
        onPointerCancel: () => { origin.current = null; },
        onPointerUp: (e) => {
            const from = origin.current;
            origin.current = null;
            if (!from) return;
            const delta = swipeStep(e.clientX - from.x, e.clientY - from.y);
            if (delta !== 0) step(delta);
        },
    }), [step]);

    return {
        day,
        setDay,
        goPrev: useCallback(() => step(-1), [step]),
        goNext: useCallback(() => step(1), [step]),
        freeHours: freeHourCount(slots, day, hours),
        swipeHandlers,
    };
}

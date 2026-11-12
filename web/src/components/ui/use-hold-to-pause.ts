/**
 * Press-and-hold detection for `StoryViewer`'s tap zones (ROK-2187): a pointer
 * held longer than `HOLD_MS` pauses the story until it lifts, and the click
 * that follows that release is swallowed so a hold never pages. A quick tap
 * stays a tap. Keyboard activation has no pointer events, so it always pages.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** A press longer than this (ms) is a hold, not a tap. */
export const HOLD_MS = 200;

export interface HoldHandlers {
    onPointerDown: () => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
}

export interface HoldToPause {
    /** True while a press has lasted past `HOLD_MS` and not yet lifted. */
    held: boolean;
    handlers: HoldHandlers;
    /** True (once) when the click being handled ends a hold — skip navigating. */
    consumeHold: () => boolean;
}

/** Tracks press-and-hold on the tap zones. */
export function useHoldToPause(): HoldToPause {
    const [held, setHeld] = useState(false);
    const timer = useRef<number | undefined>(undefined);
    const wasHeld = useRef(false);
    const clear = useCallback((): void => {
        window.clearTimeout(timer.current);
        timer.current = undefined;
    }, []);
    const onPointerDown = useCallback((): void => {
        clear();
        wasHeld.current = false;
        timer.current = window.setTimeout(() => { wasHeld.current = true; setHeld(true); }, HOLD_MS);
    }, [clear]);
    const onPointerUp = useCallback((): void => { clear(); setHeld(false); }, [clear]);
    const abandon = useCallback((): void => { onPointerUp(); wasHeld.current = false; }, [onPointerUp]);
    const consumeHold = useCallback((): boolean => {
        const was = wasHeld.current;
        wasHeld.current = false;
        return was;
    }, []);
    useEffect(() => clear, [clear]);
    return { held, consumeHold, handlers: { onPointerDown, onPointerUp, onPointerCancel: abandon, onPointerLeave: abandon } };
}

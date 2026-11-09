/**
 * ROK-2150: open state for a Forever talent icon's own tooltip (Wowhead's spell tooltip
 * shows one rank's numbers for every rank). A mouse/pen hover or keyboard focus opens
 * it; leaving, blur, Escape or a press elsewhere closes it. A touch tap toggles it
 * instead, since a phone has no hover — the icon is a button and never navigates.
 */
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { useEscapeLayer } from '../../../hooks/use-escape-layer';

export interface TalentTooltipAnchorProps {
    'aria-describedby': string | undefined;
    onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
    onPointerLeave: (e: PointerEvent<HTMLElement>) => void;
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onFocus: () => void;
    onBlur: () => void;
    onClick: () => void;
}

/** Close on a pointer press outside the anchor (`pointerdown`, so an iOS tap on a non-clickable area counts too). */
function usePressOutside(anchorRef: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
    useEffect(() => {
        if (!open) return;
        const onDown = (e: Event): void => {
            if (!(e.target instanceof Node) || !anchorRef.current?.contains(e.target)) close();
        };
        document.addEventListener('pointerdown', onDown);
        return () => document.removeEventListener('pointerdown', onDown);
    }, [anchorRef, open, close]);
}

/** Hover/focus/tap handlers for the icon; `lastPointer` tells a tap's focus + click apart from a keyboard's. */
function anchorHandlers(open: boolean, id: string, setOpen: (fn: (o: boolean) => boolean) => void,
    lastPointer: { current: string | null }): TalentTooltipAnchorProps {
    return {
        'aria-describedby': open ? id : undefined,
        onPointerEnter: (e) => { if (e.pointerType !== 'touch') setOpen(() => true); },
        onPointerLeave: (e) => { if (e.pointerType !== 'touch') setOpen(() => false); },
        onPointerDown: (e) => { lastPointer.current = e.pointerType; },
        onFocus: () => { if (lastPointer.current === null) setOpen(() => true); },
        onBlur: () => { lastPointer.current = null; setOpen(() => false); },
        onClick: () => {
            if (lastPointer.current === 'touch') setOpen((o) => !o);
            lastPointer.current = null;
        },
    };
}

export function useForeverTalentTooltip(anchorRef: RefObject<HTMLElement | null>) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const lastPointer = useRef<string | null>(null);
    const close = useCallback(() => setOpen(false), []);
    useEscapeLayer(open, close);
    usePressOutside(anchorRef, open, close);
    return { open, id, close, anchorProps: anchorHandlers(open, id, setOpen, lastPointer) };
}

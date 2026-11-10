/**
 * ROK-2150: open state for a Forever talent icon's own tooltip (Wowhead's spell tooltip
 * shows one rank's numbers for every rank). A mouse/pen hover or keyboard focus opens
 * it; leaving, blur, Escape or a press elsewhere closes it. A touch tap toggles it
 * instead, since a phone has no hover — the icon is a button and never navigates.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react';
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

/** The last pointer type pressed on the icon (null = keyboard), read and written only in event handlers. */
interface PointerKind { set: (kind: string | null) => void; get: () => string | null }

function usePointerKind(): PointerKind {
    const last = useRef<string | null>(null);
    return useMemo(() => ({ set: (kind) => { last.current = kind; }, get: () => last.current }), []);
}

/** Hover/focus/tap handlers for the icon; `pointer` tells a tap's focus + click apart from a keyboard's. */
function anchorHandlers(open: boolean, id: string, setOpen: (fn: (o: boolean) => boolean) => void,
    pointer: PointerKind): TalentTooltipAnchorProps {
    return {
        'aria-describedby': open ? id : undefined,
        onPointerEnter: (e) => { if (e.pointerType !== 'touch') setOpen(() => true); },
        onPointerLeave: (e) => { if (e.pointerType !== 'touch') setOpen(() => false); },
        onPointerDown: (e) => { pointer.set(e.pointerType); },
        onFocus: () => { if (pointer.get() === null) setOpen(() => true); },
        onBlur: () => { pointer.set(null); setOpen(() => false); },
        onClick: () => {
            if (pointer.get() === 'touch') setOpen((o) => !o);
            pointer.set(null);
        },
    };
}

export function useForeverTalentTooltip(anchorRef: RefObject<HTMLElement | null>) {
    const [open, setOpen] = useState(false);
    const id = useId();
    const pointer = usePointerKind();
    const close = useCallback(() => setOpen(false), []);
    useEscapeLayer(open, close);
    usePressOutside(anchorRef, open, close);
    return { open, id, close, anchorProps: anchorHandlers(open, id, setOpen, pointer) };
}

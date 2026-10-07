/**
 * Escape for stacked overlays (ROK-1738): ONE window keydown listener for every
 * open `ModalFrame` / `BottomSheet`, and one Escape closes ONE overlay.
 *
 * Before this, each overlay added its own listener, so with a dialog stacked
 * over another (the import dialog over Add Character) one Escape closed both.
 *
 * The key goes to the most recently OPENED overlay — the top layer. Every
 * overlay here is `aria-modal`, so while one is open the layers under it are
 * inert, and the top layer is the one the user is looking at. It does not ask
 * where focus is: a just-opened confirm moves focus in a frame later, and an
 * Escape in that frame must still reach the confirm, not the sheet under it
 * (ROK-1640's GameTimeCheckSheet case), and a click on non-focusable content
 * leaves focus on `<body>` — a lone overlay still closes on Escape.
 * Layers register in effect order, i.e. in the order they open.
 */
import { useEffect, useRef, type RefObject } from 'react';

/** `onEscape` refs of the open overlays, in opening order (last = top). */
const layers: RefObject<() => void>[] = [];

function handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    layers[layers.length - 1]?.current();
}

/** Registers an open overlay; `onEscape` runs only while it is the top layer (see file docstring). */
export function useEscapeLayer(active: boolean, onEscape: () => void): void {
    const onEscapeRef = useRef(onEscape);
    useEffect(() => { onEscapeRef.current = onEscape; }, [onEscape]);

    useEffect(() => {
        if (!active) return;
        const layer = onEscapeRef;
        layers.push(layer);
        if (layers.length === 1) window.addEventListener('keydown', handleKeyDown);
        return () => {
            layers.splice(layers.indexOf(layer), 1);
            if (layers.length === 0) window.removeEventListener('keydown', handleKeyDown);
        };
    }, [active]);
}

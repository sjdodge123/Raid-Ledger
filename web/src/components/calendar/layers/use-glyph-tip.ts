/**
 * ROK-1774 — glyph tooltip state. Visibility is state-driven, never CSS
 * `:hover`/`:focus-within`, because touch WebKit keeps `:hover` stuck after a tap
 * and a tapped button stays focused. A mouse hover shows it; a tap/click toggles
 * it; keyboard focus opens it; blur, a tap elsewhere or Escape closes it.
 */
import { useCallback, useEffect, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent } from 'react';
import { placeTip, type TipPlacement } from './layer-tip-placement';
import { useCalendarLayerContext } from './calendar-layer-context';

const DEFAULT_PLACEMENT: TipPlacement = { side: 'right', maxWidth: 256 };

function useTipPlacement(): { placement: TipPlacement; measure: (el: Element) => void } {
    const ctx = useCalendarLayerContext();
    const [placement, setPlacement] = useState<TipPlacement>(DEFAULT_PLACEMENT);
    const measure = useCallback((el: Element) => {
        const viewport = window.innerWidth;
        const grid = ctx?.gridRef.current?.getBoundingClientRect();
        const anchor = el.getBoundingClientRect();
        setPlacement(placeTip({
            anchorLeft: anchor.left, anchorRight: anchor.right,
            boundaryLeft: Math.max(grid?.left ?? 0, 0), boundaryRight: Math.min(grid?.right ?? viewport, viewport),
        }));
    }, [ctx]);
    return { placement, measure };
}

/** While open, any pointerdown that reaches the document (the glyph stops its own) or Escape closes it. */
function useDismiss(open: boolean, close: () => void): void {
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
        document.addEventListener('pointerdown', close);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, close]);
}

export interface GlyphTipHandlers {
    onPointerDown: () => void;
    onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => void;
    onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => void;
    onFocus: (e: FocusEvent<HTMLButtonElement>) => void;
    onBlur: () => void;
    onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function useGlyphTip(): { visible: boolean; placement: TipPlacement; handlers: GlyphTipHandlers } {
    const { placement, measure } = useTipPlacement();
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(false);
    const fromPointer = useRef(false);
    const close = useCallback(() => { setHover(false); setPinned(false); }, []);
    useDismiss(hover || pinned, close);
    const handlers: GlyphTipHandlers = {
        onPointerDown: () => { fromPointer.current = true; },
        onPointerEnter: (e) => { measure(e.currentTarget); if (e.pointerType === 'mouse') setHover(true); },
        onPointerLeave: (e) => { if (e.pointerType === 'mouse') setHover(false); },
        onFocus: (e) => { measure(e.currentTarget); if (!fromPointer.current) setPinned(true); },
        onBlur: () => { fromPointer.current = false; setPinned(false); },
        onClick: (e) => {
            e.stopPropagation();
            measure(e.currentTarget);
            fromPointer.current = true;
            e.currentTarget.focus();
            fromPointer.current = false;
            setPinned((p) => !p);
        },
    };
    return { visible: hover || pinned, placement, handlers };
}

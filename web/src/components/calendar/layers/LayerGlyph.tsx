/**
 * ROK-1774 — the power glyph: the ONLY layer element that takes the pointer.
 * Hover, keyboard focus or a tap (Lead ruling Q8) shows the tooltip; the tooltip
 * opens LEFT when it would not fit right of the glyph inside the grid (AC8).
 * Pointer/mouse/touch-down stop propagating so react-big-calendar's document-level
 * slot selection never starts on the glyph.
 */
import { useCallback, useState, type JSX, type SyntheticEvent } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import { chooseTipSide } from './calendar-layer-events';
import { useCalendarLayerContext } from './calendar-layer-context';

export interface LayerGlyphProps {
    title: string;
    detail: string;
}

type TipSide = 'left' | 'right';

const stop = (e: SyntheticEvent): void => e.stopPropagation();

const TIP_BASE = 'absolute top-1/2 z-30 w-max max-w-[16rem] -translate-y-1/2 break-words rounded-md border border-edge-strong bg-surface px-2 py-1 text-xs shadow-lg transition-opacity';
const TIP_HIDDEN = 'invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100';

function useTipSide(): { side: TipSide; measure: (el: Element) => void } {
    const ctx = useCalendarLayerContext();
    const [side, setSide] = useState<TipSide>('right');
    const measure = useCallback((el: Element) => {
        const viewport = window.innerWidth;
        const grid = ctx?.gridRef.current?.getBoundingClientRect().right ?? viewport;
        setSide(chooseTipSide({ anchorRight: el.getBoundingClientRect().right, boundaryRight: Math.min(grid, viewport) }));
    }, [ctx]);
    return { side, measure };
}

function GlyphTip({ title, detail, side, open }: LayerGlyphProps & { side: TipSide; open: boolean }): JSX.Element {
    const sideClass = side === 'left' ? 'right-5' : 'left-5';
    return (
        <span role="tooltip" data-side={side} className={`${TIP_BASE} ${sideClass} ${open ? 'visible opacity-100' : TIP_HIDDEN}`}>
            <span className="block text-foreground">{title}</span>
            <span className="block text-muted">{detail}</span>
        </span>
    );
}

export function LayerGlyph({ title, detail }: LayerGlyphProps): JSX.Element {
    const { side, measure } = useTipSide();
    const [open, setOpen] = useState(false);
    const onClick = (e: SyntheticEvent<HTMLButtonElement>): void => {
        stop(e);
        measure(e.currentTarget);
        e.currentTarget.focus();
        setOpen((o) => !o);
    };
    return (
        <span className="group relative pointer-events-auto inline-flex" onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onDoubleClick={stop}>
            <button
                type="button" data-testid="layer-marker-glyph" aria-label={`${title}. ${detail}`} aria-expanded={open}
                onClick={onClick} onBlur={() => setOpen(false)}
                onPointerEnter={(e) => measure(e.currentTarget)} onFocus={(e) => measure(e.currentTarget)}
                className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-edge-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-success"
            >
                <PowerIcon aria-hidden="true" className="h-3 w-3" />
            </button>
            <GlyphTip title={title} detail={detail} side={side} open={open} />
        </span>
    );
}

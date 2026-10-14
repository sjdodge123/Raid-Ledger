/**
 * ROK-1774 — the power glyph: the ONLY layer element that takes the pointer.
 * Hover, keyboard focus or a tap (Lead ruling Q8) shows the tooltip; a second tap,
 * a tap elsewhere or Escape hides it. The tooltip opens toward the side with room
 * and is width-capped to it, so it stays inside the viewport and grid (AC8).
 * Coincident markers share ONE glyph whose tooltip lists every one of them.
 * Pointer/mouse/touch-down stop propagating so react-big-calendar's document-level
 * slot selection never starts on the glyph.
 */
import type { JSX, SyntheticEvent } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import { Button } from '../../ui/button';
import type { TipPlacement } from './layer-tip-placement';
import { useGlyphTip } from './use-glyph-tip';

export interface LayerGlyphTip {
    title: string;
    detail: string;
}

export interface LayerGlyphProps {
    tips: readonly LayerGlyphTip[];
}

const stop = (e: SyntheticEvent): void => e.stopPropagation();

const TIP_BASE = 'absolute top-1/2 z-30 w-max max-w-[16rem] -translate-y-1/2 break-words rounded-md border border-edge-strong bg-surface px-2 py-1 text-xs shadow-lg transition-opacity';

function GlyphTip({ tips, placement, visible }: LayerGlyphProps & { placement: TipPlacement; visible: boolean }): JSX.Element {
    const sideClass = placement.side === 'left' ? 'right-5' : 'left-5';
    return (
        <span
            role="tooltip" data-side={placement.side} style={{ maxWidth: `${placement.maxWidth}px` }}
            className={`${TIP_BASE} ${sideClass} ${visible ? 'visible opacity-100' : 'invisible opacity-0'}`}
        >
            {tips.map((tip, idx) => (
                <span key={idx} data-testid="layer-tip-entry" className={`block ${idx > 0 ? 'mt-1 border-t border-edge pt-1' : ''}`}>
                    <span className="block text-foreground">{tip.title}</span>
                    <span className="block text-muted">{tip.detail}</span>
                </span>
            ))}
        </span>
    );
}

function glyphAriaLabel(tips: readonly LayerGlyphTip[]): string {
    return tips.map((t) => `${t.title}. ${t.detail}`).join(' ');
}

export function LayerGlyph({ tips }: LayerGlyphProps): JSX.Element {
    const { visible, placement, handlers } = useGlyphTip();
    return (
        <span className="relative pointer-events-auto inline-flex" onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onDoubleClick={stop}>
            <Button
                variant="bare" data-testid="layer-marker-glyph" aria-label={glyphAriaLabel(tips)} aria-expanded={visible}
                {...handlers}
                className="h-4 w-4 rounded-full bg-surface text-muted ring-1 ring-edge-strong focus:outline-none"
            >
                <PowerIcon aria-hidden="true" className="h-3 w-3" />
            </Button>
            <GlyphTip tips={tips} placement={placement} visible={visible} />
        </span>
    );
}

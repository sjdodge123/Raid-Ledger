/**
 * ROK-1774 — the label inside a server-up band (wireframe `WindowBand`). It WRAPS
 * (AC13) while the band is tall enough; `calendar-layers.css` container queries put
 * a short band's label on one ellipsised line and hide it on a band shorter than a
 * line, so it is never cut mid-glyph. The full text stays in `title` (on the label
 * root and the visible text) and the sr-only span always carries the band.
 */
import type { JSX } from 'react';
import type { LayerWindowEvent } from './calendar-layer-events';

export function LayerWindowLabel({ event }: { event: LayerWindowEvent }): JSX.Element {
    return (
        <span data-testid="layer-window-label" title={event.title} className="block break-words px-1 pt-0.5 text-[11px] leading-tight text-dim">
            <span aria-hidden="true" title={event.title} className="rl-layer-window-text">{event.title}</span>
            <span className="sr-only">{event.layer.ariaLabel}</span>
        </span>
    );
}

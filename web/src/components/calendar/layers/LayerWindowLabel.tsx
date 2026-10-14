/** ROK-1774 — the label inside a server-up band (wireframe `WindowBand`, but it WRAPS — AC13). */
import type { JSX } from 'react';
import type { LayerWindowEvent } from './calendar-layer-events';

export function LayerWindowLabel({ event }: { event: LayerWindowEvent }): JSX.Element {
    return (
        <span data-testid="layer-window-label" className="block break-words px-1 pt-0.5 text-[11px] leading-tight text-dim">
            <span aria-hidden="true">{event.title}</span>
            <span className="sr-only">{event.layer.ariaLabel}</span>
        </span>
    );
}

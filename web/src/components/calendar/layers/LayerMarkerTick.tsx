/**
 * ROK-1774 — a restart / orphan-stop tick across a day column, above events
 * (wireframe `MarkerTick`). `coincident` markers sit at the same minute; they share
 * this tick's glyph and are listed in its tooltip instead of hiding each other.
 */
import type { JSX } from 'react';
import type { ZonedLayerMarker } from './calendar-layer-events';
import { LayerGlyph } from './LayerGlyph';

export interface LayerMarkerTickProps {
    marker: ZonedLayerMarker;
    coincident?: readonly ZonedLayerMarker[];
}

export function LayerMarkerTick({ marker, coincident = [] }: LayerMarkerTickProps): JSX.Element {
    const tips = [marker, ...coincident].map((m) => m.marker.tip);
    return (
        <div
            data-testid="layer-marker-tick"
            className="rl-layer-tick pointer-events-none absolute inset-x-0 h-0"
            style={{ top: `${(marker.minuteOfDay / 1440) * 100}%` }}
        >
            <div className="absolute inset-x-0 top-0 border-t-2 border-solid border-edge-strong" />
            <span className="absolute left-0.5 top-px -translate-y-1/2">
                <LayerGlyph tips={tips} />
            </span>
        </div>
    );
}

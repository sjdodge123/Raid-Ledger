/** ROK-1774 — a restart / orphan-stop tick across a day column, above events (wireframe `MarkerTick`). */
import type { JSX } from 'react';
import type { ZonedLayerMarker } from './calendar-layer-events';
import { LayerGlyph } from './LayerGlyph';

export function LayerMarkerTick({ marker }: { marker: ZonedLayerMarker }): JSX.Element {
    return (
        <div
            data-testid="layer-marker-tick"
            className="rl-layer-tick pointer-events-none absolute inset-x-0 h-0"
            style={{ top: `${(marker.minuteOfDay / 1440) * 100}%` }}
        >
            <div className="absolute inset-x-0 top-0 border-t-2 border-solid border-edge-strong" />
            <span className="absolute left-0.5 top-px -translate-y-1/2">
                <LayerGlyph title={marker.marker.tip.title} detail={marker.marker.tip.detail} />
            </span>
        </div>
    );
}

/**
 * ROK-1774 — the `.calendar-grid-wrapper` plus the layer context: the day-column
 * wrapper reads the zoned markers, and glyph tooltips measure this element's right
 * edge to decide which way to open. Adds no DOM beyond the wrapper div it replaces.
 */
import { useMemo, useRef, type JSX, type ReactNode } from 'react';
import { CalendarLayerContext } from './calendar-layer-context';
import type { ZonedLayerMarker } from './calendar-layer-events';
import { NO_LAYER_DAYS, type LayerDayMap } from './calendar-layer-days';

export interface CalendarLayerGridProps {
    markers: readonly ZonedLayerMarker[];
    dayEntries?: LayerDayMap;
    children: ReactNode;
}

export function CalendarLayerGrid({ markers, dayEntries = NO_LAYER_DAYS, children }: CalendarLayerGridProps): JSX.Element {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const value = useMemo(() => ({ markers, dayEntries, gridRef }), [markers, dayEntries]);
    return (
        <CalendarLayerContext.Provider value={value}>
            <div className="calendar-grid-wrapper" ref={gridRef}>{children}</div>
        </CalendarLayerContext.Provider>
    );
}

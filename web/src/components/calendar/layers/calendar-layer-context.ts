/** ROK-1774 — what the day-column wrapper and glyph tooltips read from CalendarView. */
import { createContext, useContext, type RefObject } from 'react';
import type { ZonedLayerMarker } from './calendar-layer-events';
import type { LayerDayMap } from './calendar-layer-days';

export interface CalendarLayerContextValue {
    markers: readonly ZonedLayerMarker[];
    /** ROK-1775 — per-local-day entries for the Month glyph. */
    dayEntries: LayerDayMap;
    /** The `.calendar-grid-wrapper`; its right edge bounds tooltip flipping. */
    gridRef: RefObject<HTMLDivElement | null>;
}

export const CalendarLayerContext = createContext<CalendarLayerContextValue | null>(null);

export function useCalendarLayerContext(): CalendarLayerContextValue | null {
    return useContext(CalendarLayerContext);
}

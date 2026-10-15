/** ROK-1774 — CalendarView's single entry point into plugin calendar layers. */
import { useMemo } from 'react';
import { useCalendarLayers } from '../../../plugins/calendar-layer';
import {
    toLayerBackgroundEvents, zonedMarkers, type LayerWindowEvent, type ZonedLayerMarker,
} from './calendar-layer-events';
import { groupLayerItemsByDay, type LayerDayMap } from './calendar-layer-days';

export interface CalendarLayerData {
    backgroundEvents: LayerWindowEvent[];
    markers: readonly ZonedLayerMarker[];
    /** ROK-1775 — Month glyph + Schedule rows. */
    dayEntries: LayerDayMap;
}

export interface CalendarLayerDataInput {
    from: string;
    to: string;
    selectedGames: ReadonlySet<string> | undefined;
    /** False → no layer fetches (ROK-1775: every view draws layers now). */
    viewEnabled: boolean;
    tz: string;
}

export function useCalendarLayerData({ from, to, selectedGames, viewEnabled, tz }: CalendarLayerDataInput): CalendarLayerData {
    const range = useMemo(() => ({ from, to }), [from, to]);
    const items = useCalendarLayers(range, selectedGames, viewEnabled);
    const backgroundEvents = useMemo(() => toLayerBackgroundEvents(items, tz), [items, tz]);
    const markers = useMemo(() => zonedMarkers(items, tz), [items, tz]);
    const dayEntries = useMemo(() => groupLayerItemsByDay(items, tz), [items, tz]);
    return { backgroundEvents, markers, dayEntries };
}

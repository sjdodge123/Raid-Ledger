/** ROK-1774 — CalendarView's single entry point into plugin calendar layers. */
import { useMemo } from 'react';
import { useCalendarLayers } from '../../../plugins/calendar-layer';
import {
    toLayerBackgroundEvents, zonedMarkers, type LayerWindowEvent, type ZonedLayerMarker,
} from './calendar-layer-events';

export interface CalendarLayerData {
    backgroundEvents: LayerWindowEvent[];
    markers: readonly ZonedLayerMarker[];
}

export interface CalendarLayerDataInput {
    from: string;
    to: string;
    selectedGames: ReadonlySet<string> | undefined;
    /** Week/day only (S6a); month and schedule pass false so no layer fetches. */
    viewEnabled: boolean;
    tz: string;
}

export function useCalendarLayerData({ from, to, selectedGames, viewEnabled, tz }: CalendarLayerDataInput): CalendarLayerData {
    const range = useMemo(() => ({ from, to }), [from, to]);
    const items = useCalendarLayers(range, selectedGames, viewEnabled);
    const backgroundEvents = useMemo(() => toLayerBackgroundEvents(items, tz), [items, tz]);
    const markers = useMemo(() => zonedMarkers(items, tz), [items, tz]);
    return { backgroundEvents, markers };
}

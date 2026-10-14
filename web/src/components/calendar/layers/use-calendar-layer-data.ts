/** ROK-1774 — CalendarView's single entry point into plugin calendar layers. */
import { useMemo, useRef } from 'react';
import { useCalendarLayers } from '../../../plugins/calendar-layer';
import { toLayerBackgroundEvents, zonedMarkers, type LayerWindowEvent } from './calendar-layer-events';
import type { CalendarLayerContextValue } from './calendar-layer-context';

export interface CalendarLayerData {
    backgroundEvents: LayerWindowEvent[];
    context: CalendarLayerContextValue;
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
    const gridRef = useRef<HTMLDivElement | null>(null);
    const backgroundEvents = useMemo(() => toLayerBackgroundEvents(items, tz), [items, tz]);
    const markers = useMemo(() => zonedMarkers(items, tz), [items, tz]);
    const context = useMemo(() => ({ markers, gridRef }), [markers]);
    return { backgroundEvents, context };
}

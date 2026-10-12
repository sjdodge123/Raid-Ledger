import type { JSX } from 'react';
import type { GameTimeCalendarBusy, GameTimeEventBlock } from '@raid-ledger/contract';
import type { GridDims, GameTimePreviewBlock } from './game-time-grid.types';
import {
    EventBlockOverlays, PreviewBlockOverlays,
} from './GridOverlays';
import { CalendarBusyLayer } from './CalendarBusyLayer';

interface GridOverlayLayerProps {
    gridDims: GridDims | null;
    rangeStart: number;
    rangeEnd: number;
    displayEvents: GameTimeEventBlock[];
    previewBlocks?: GameTimePreviewBlock[] | undefined;
    /** Visible hours in grid order — the busy band's index space. */
    hours?: number[] | undefined;
    /** ROK-1595 S2: the viewer's own synced busy hours (NP-1). */
    calendarBusy?: readonly GameTimeCalendarBusy[] | undefined;
}

/** Renders all positioned overlays: own-calendar busy bands, events, previews */
export function GridOverlayLayer(props: GridOverlayLayerProps): JSX.Element | null {
    const { gridDims, rangeStart, rangeEnd, displayEvents, previewBlocks, hours, calendarBusy } = props;

    return (
        <>
            {gridDims && hours && <CalendarBusyLayer busy={calendarBusy} gridDims={gridDims} hours={hours} />}
            <EventsOverlay displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
            <PreviewsOverlay previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
        </>
    );
}

function EventsOverlay({ displayEvents, gridDims, rangeStart, rangeEnd }: {
    displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (displayEvents.length === 0 || !gridDims) return null;
    return <EventBlockOverlays displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

function PreviewsOverlay({ previewBlocks, displayEvents, gridDims, rangeStart, rangeEnd }: {
    previewBlocks?: GameTimePreviewBlock[] | undefined; displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (!previewBlocks || previewBlocks.length === 0 || !gridDims) return null;
    return <PreviewBlockOverlays previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

import type { JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import type { GridDims, GameTimePreviewBlock } from './game-time-grid.types';
import {
    TodayHighlight, CurrentTimeIndicator,
    EventBlockOverlays, PreviewBlockOverlays,
} from './GridOverlays';

interface GridOverlayLayerProps {
    todayIndex?: number | undefined;
    currentHour?: number | undefined;
    gridDims: GridDims | null;
    HOURS: number[];
    rangeStart: number;
    rangeEnd: number;
    displayEvents: GameTimeEventBlock[];
    onEventClick?: ((event: GameTimeEventBlock, anchorRect: DOMRect) => void) | undefined;
    previewBlocks?: GameTimePreviewBlock[] | undefined;
}

/** Renders all positioned overlays: time indicator, highlights, events, previews */
export function GridOverlayLayer(props: GridOverlayLayerProps): JSX.Element | null {
    const { todayIndex, currentHour, gridDims, HOURS, rangeStart, rangeEnd, displayEvents, onEventClick, previewBlocks } = props;

    return (
        <>
            <TodayOverlay todayIndex={todayIndex} gridDims={gridDims} hoursCount={HOURS.length} />
            <TimeOverlay todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
            <EventsOverlay displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} onEventClick={onEventClick} />
            <PreviewsOverlay previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
        </>
    );
}

function TodayOverlay({ todayIndex, gridDims, hoursCount }: {
    todayIndex?: number | undefined; gridDims: GridDims | null; hoursCount: number;
}): JSX.Element | null {
    if (todayIndex === undefined || !gridDims) return null;
    return <TodayHighlight todayIndex={todayIndex} gridDims={gridDims} hoursCount={hoursCount} />;
}

function TimeOverlay({ todayIndex, currentHour, gridDims, rangeStart, rangeEnd }: {
    todayIndex?: number | undefined; currentHour?: number | undefined; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (todayIndex === undefined || currentHour === undefined || !gridDims) return null;
    return <CurrentTimeIndicator todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

function EventsOverlay({ displayEvents, gridDims, rangeStart, rangeEnd, onEventClick }: {
    displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
    onEventClick?: ((event: GameTimeEventBlock, anchorRect: DOMRect) => void) | undefined;
}): JSX.Element | null {
    if (displayEvents.length === 0 || !gridDims) return null;
    return <EventBlockOverlays displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} onEventClick={onEventClick} />;
}

function PreviewsOverlay({ previewBlocks, displayEvents, gridDims, rangeStart, rangeEnd }: {
    previewBlocks?: GameTimePreviewBlock[] | undefined; displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (!previewBlocks || previewBlocks.length === 0 || !gridDims) return null;
    return <PreviewBlockOverlays previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

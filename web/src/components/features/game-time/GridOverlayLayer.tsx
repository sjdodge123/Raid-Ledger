import type { JSX } from 'react';
import type { GameTimeEventBlock, GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims, GameTimePreviewBlock } from './game-time-grid.types';
import {
    RollingWeekDivider, TodayHighlight, CurrentTimeIndicator,
    EventBlockOverlays, PreviewBlockOverlays,
} from './GridOverlays';

interface GridOverlayLayerProps {
    todayIndex?: number;
    currentHour?: number;
    gridDims: GridDims | null;
    nextWeekSlots?: GameTimeSlot[];
    HOURS: number[];
    rangeStart: number;
    rangeEnd: number;
    displayEvents: GameTimeEventBlock[];
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
    previewBlocks?: GameTimePreviewBlock[];
}

/** Renders all positioned overlays: time indicator, highlights, events, previews */
export function GridOverlayLayer(props: GridOverlayLayerProps): JSX.Element | null {
    const { todayIndex, currentHour, gridDims, nextWeekSlots, HOURS, rangeStart, rangeEnd, displayEvents, onEventClick, previewBlocks } = props;

    return (
        <>
            <RollingDividerOverlay todayIndex={todayIndex} gridDims={gridDims} nextWeekSlots={nextWeekSlots} currentHour={currentHour} hoursCount={HOURS.length} rangeStart={rangeStart} />
            <TodayOverlay todayIndex={todayIndex} gridDims={gridDims} nextWeekSlots={nextWeekSlots} currentHour={currentHour} hoursCount={HOURS.length} rangeStart={rangeStart} />
            <TimeOverlay todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
            <EventsOverlay displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} onEventClick={onEventClick} />
            <PreviewsOverlay previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />
        </>
    );
}

function RollingDividerOverlay({ todayIndex, gridDims, nextWeekSlots, currentHour, hoursCount, rangeStart }: {
    todayIndex?: number; gridDims: GridDims | null; nextWeekSlots?: GameTimeSlot[]; currentHour?: number; hoursCount: number; rangeStart: number;
}): JSX.Element | null {
    if (todayIndex === undefined || !nextWeekSlots || !gridDims || currentHour === undefined) return null;
    return <RollingWeekDivider todayIndex={todayIndex} gridDims={gridDims} currentHour={currentHour} hoursCount={hoursCount} rangeStart={rangeStart} />;
}

function TodayOverlay({ todayIndex, gridDims, nextWeekSlots, currentHour, hoursCount, rangeStart }: {
    todayIndex?: number; gridDims: GridDims | null; nextWeekSlots?: GameTimeSlot[]; currentHour?: number; hoursCount: number; rangeStart: number;
}): JSX.Element | null {
    if (todayIndex === undefined || !gridDims) return null;
    return <TodayHighlight todayIndex={todayIndex} gridDims={gridDims} hoursCount={hoursCount} hasRolling={!!nextWeekSlots} currentHour={currentHour} rangeStart={rangeStart} />;
}

function TimeOverlay({ todayIndex, currentHour, gridDims, rangeStart, rangeEnd }: {
    todayIndex?: number; currentHour?: number; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (todayIndex === undefined || currentHour === undefined || !gridDims) return null;
    return <CurrentTimeIndicator todayIndex={todayIndex} currentHour={currentHour} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

function EventsOverlay({ displayEvents, gridDims, rangeStart, rangeEnd, onEventClick }: {
    displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
}): JSX.Element | null {
    if (displayEvents.length === 0 || !gridDims) return null;
    return <EventBlockOverlays displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} onEventClick={onEventClick} />;
}

function PreviewsOverlay({ previewBlocks, displayEvents, gridDims, rangeStart, rangeEnd }: {
    previewBlocks?: GameTimePreviewBlock[]; displayEvents: GameTimeEventBlock[]; gridDims: GridDims | null; rangeStart: number; rangeEnd: number;
}): JSX.Element | null {
    if (!previewBlocks || previewBlocks.length === 0 || !gridDims) return null;
    return <PreviewBlockOverlays previewBlocks={previewBlocks} displayEvents={displayEvents} gridDims={gridDims} rangeStart={rangeStart} rangeEnd={rangeEnd} />;
}

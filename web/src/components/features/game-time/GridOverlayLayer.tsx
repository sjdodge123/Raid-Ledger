import type { JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import type { GridDims, GameTimePreviewBlock } from './game-time-grid.types';
import {
    EventBlockOverlays, PreviewBlockOverlays,
} from './GridOverlays';

interface GridOverlayLayerProps {
    gridDims: GridDims | null;
    rangeStart: number;
    rangeEnd: number;
    displayEvents: GameTimeEventBlock[];
    previewBlocks?: GameTimePreviewBlock[] | undefined;
}

/** Renders all positioned overlays: events, previews */
export function GridOverlayLayer(props: GridOverlayLayerProps): JSX.Element | null {
    const { gridDims, rangeStart, rangeEnd, displayEvents, previewBlocks } = props;

    return (
        <>
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

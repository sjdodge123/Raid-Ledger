import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { RichEventBlock } from './RichEventBlock';
import type { GameTimePreviewBlock, GridDims } from './game-time-grid.types';

interface PreviewBlockOverlaysProps {
    previewBlocks: GameTimePreviewBlock[];
    displayEvents: GameTimeEventBlock[];
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
}

/** Renders cyan-bordered preview blocks for proposed event times */
export function PreviewBlockOverlays({
    previewBlocks, displayEvents, gridDims, rangeStart, rangeEnd,
}: PreviewBlockOverlaysProps): JSX.Element {
    return (
        <>
            {previewBlocks.map((block, i) => {
                const pos = computePreviewPosition(block, gridDims, rangeStart, rangeEnd);
                if (!pos) return null;
                const hasEventUnderneath = displayEvents.some(
                    (ev) => ev.dayOfWeek === block.dayOfWeek && ev.startHour < block.endHour && ev.endHour > block.startHour,
                );
                return (
                    <PreviewBlock
                        key={`preview-${block.dayOfWeek}-${block.startHour}-${i}`}
                        block={block} pos={pos} hasEventUnderneath={hasEventUnderneath}
                    />
                );
            })}
        </>
    );
}

interface PreviewPosition { top: number; left: number; width: number; height: number; }

/** Computes the absolute position for a preview block */
function computePreviewPosition(
    block: GameTimePreviewBlock, gridDims: GridDims,
    rangeStart: number, rangeEnd: number,
): PreviewPosition | null {
    const visStart = Math.max(block.startHour, rangeStart);
    const visEnd = Math.min(block.endHour, rangeEnd);
    if (visStart >= visEnd) return null;

    const spanHours = visEnd - visStart;
    const colGap = gridDims.colWidth + 1;
    return {
        top: gridDims.headerHeight + (visStart - rangeStart) * gridDims.rowHeight,
        height: Math.max(spanHours * gridDims.rowHeight - 1, 0),
        left: gridDims.colStartLeft + block.dayOfWeek * colGap,
        width: Math.max(gridDims.colWidth, 0),
    };
}

function PreviewBlock({ block, pos, hasEventUnderneath }: {
    block: GameTimePreviewBlock; pos: PreviewPosition; hasEventUnderneath: boolean;
}): JSX.Element {
    const isSelected = block.variant === 'selected';
    const borderStyle = isSelected ? '3px solid rgba(6, 182, 212, 0.95)' : '3px dashed rgba(6, 182, 212, 0.85)';
    const shadowStyle = '0 0 14px rgba(6, 182, 212, 0.4), inset 0 0 8px rgba(6, 182, 212, 0.1)';

    return (
        <div
            className="absolute z-[21] rounded-sm pointer-events-none"
            style={{ top: pos.top, left: pos.left, width: pos.width, height: pos.height, border: borderStyle, boxShadow: shadowStyle }}
            data-testid={`preview-block-${block.dayOfWeek}-${block.startHour}`}
        >
            {!hasEventUnderneath && block.title && (
                <RichEventBlock
                    event={{
                        title: block.title ?? block.label ?? 'Event',
                        gameName: block.gameName, gameSlug: block.gameSlug,
                        coverUrl: block.coverUrl, startHour: block.startHour,
                        endHour: block.endHour, description: block.description,
                        creatorUsername: block.creatorUsername,
                        signupsPreview: block.attendees, signupCount: block.attendeeCount,
                    }}
                    spanHours={block.endHour - block.startHour}
                />
            )}
        </div>
    );
}

import type { JSX } from 'react';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { getGameTimeBlockStyle } from '../../../constants/game-colors';
import { RichEventBlock } from './RichEventBlock';
import type { GridDims } from './game-time-grid.types';

interface EventBlockOverlaysProps {
    displayEvents: GameTimeEventBlock[];
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
}

/** Renders positioned event blocks overlaid on the grid */
export function EventBlockOverlays({
    displayEvents, gridDims, rangeStart, rangeEnd, onEventClick,
}: EventBlockOverlaysProps): JSX.Element {
    const dayEventCounts = new Map<string, number>();

    return (
        <>
            {displayEvents.map((ev) => {
                const pos = computeEventPosition(ev, gridDims, rangeStart, rangeEnd, dayEventCounts);
                if (!pos) return null;
                return (
                    <EventBlock key={`event-${ev.eventId}-${ev.dayOfWeek}`} ev={ev} pos={pos} onEventClick={onEventClick} />
                );
            })}
        </>
    );
}

interface EventPosition { top: number; left: number; width: number; height: number; spanHours: number; }

/** Computes the absolute position for an event block, tracking stacking per day-slot */
function computeEventPosition(
    ev: GameTimeEventBlock, gridDims: GridDims,
    rangeStart: number, rangeEnd: number,
    dayEventCounts: Map<string, number>,
): EventPosition | null {
    const visStart = Math.max(ev.startHour, rangeStart);
    const visEnd = Math.min(ev.endHour, rangeEnd);
    if (visStart >= visEnd) return null;

    const spanHours = visEnd - visStart;
    const top = gridDims.headerHeight + (visStart - rangeStart) * gridDims.rowHeight;
    const height = spanHours * gridDims.rowHeight - 1;
    const colGap = gridDims.colWidth + 1;
    const dayKey = `${ev.dayOfWeek}:${visStart}`;
    const stackIndex = dayEventCounts.get(dayKey) ?? 0;
    dayEventCounts.set(dayKey, stackIndex + 1);
    const stackOffset = stackIndex * 2;

    return {
        top, height: Math.max(height, 0), spanHours,
        left: gridDims.colStartLeft + ev.dayOfWeek * colGap + stackOffset,
        width: Math.max(gridDims.colWidth - stackOffset, 0),
    };
}

function EventBlock({ ev, pos, onEventClick }: {
    ev: GameTimeEventBlock; pos: EventPosition;
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
}): JSX.Element {
    return (
        <div
            className="absolute z-20 rounded-sm overflow-hidden cursor-pointer hover:brightness-110 transition-all"
            style={{ top: pos.top, left: pos.left, width: pos.width, height: pos.height, ...getGameTimeBlockStyle(ev.gameSlug ?? undefined, ev.coverUrl) }}
            data-testid={`event-block-${ev.eventId}-${ev.dayOfWeek}`}
            onClick={(e) => { e.stopPropagation(); onEventClick?.(ev, (e.currentTarget as HTMLElement).getBoundingClientRect()); }}
            title={`${ev.title}${ev.gameName ? ` (${ev.gameName})` : ''}`}
        >
            <RichEventBlock
                event={{
                    title: ev.title, gameName: ev.gameName, gameSlug: ev.gameSlug,
                    gameId: ev.gameId, coverUrl: ev.coverUrl, startHour: ev.startHour,
                    endHour: ev.endHour, description: ev.description,
                    creatorUsername: ev.creatorUsername, signupsPreview: ev.signupsPreview,
                    signupCount: ev.signupCount,
                }}
                spanHours={ev.endHour - ev.startHour}
            />
        </div>
    );
}

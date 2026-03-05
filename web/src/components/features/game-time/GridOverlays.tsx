import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { getGameTimeBlockStyle } from '../../../constants/game-colors';
import { RichEventBlock } from './RichEventBlock';
import type { GameTimePreviewBlock } from './game-time-grid.types';

interface GridDims {
    colWidth: number;
    rowHeight: number;
    headerHeight: number;
    colStartLeft: number;
}

interface RollingWeekDividerProps {
    todayIndex: number;
    gridDims: GridDims;
    currentHour: number;
    hoursCount: number;
    rangeStart: number;
}

export function RollingWeekDivider({
    todayIndex,
    gridDims,
    currentHour,
    hoursCount,
    rangeStart,
}: RollingWeekDividerProps) {
    const borderStyle = '2px dashed rgba(148, 163, 184, 0.3)';
    const totalHeight = hoursCount * gridDims.rowHeight;
    const relativeHour = currentHour - rangeStart;
    const redLineY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));
    const colGap = gridDims.colWidth + 1; // CELL_GAP = 1
    const todayLeft = gridDims.colStartLeft + todayIndex * colGap;
    const todayRight = todayLeft + colGap;

    return (
        <>
            {todayIndex > 0 && redLineY < totalHeight && (
                <div
                    className="absolute z-[6] pointer-events-none"
                    style={{
                        top: gridDims.headerHeight + redLineY,
                        left: todayLeft - 1,
                        width: 0,
                        height: totalHeight - redLineY,
                        borderLeft: borderStyle,
                    }}
                    data-testid="rolling-week-divider-left"
                />
            )}
            {redLineY > 0 && (
                <div
                    className="absolute z-[6] pointer-events-none"
                    style={{
                        top: gridDims.headerHeight + redLineY,
                        left: todayIndex > 0 ? todayLeft - 1 : todayLeft,
                        width: todayIndex > 0 ? todayRight - todayLeft : colGap,
                        height: 0,
                        borderTop: borderStyle,
                    }}
                    data-testid="rolling-week-divider-bottom"
                />
            )}
            {redLineY > 0 && (
                <div
                    className="absolute z-[6] pointer-events-none"
                    style={{
                        top: gridDims.headerHeight,
                        left: todayRight - 1,
                        width: 0,
                        height: redLineY,
                        borderLeft: borderStyle,
                    }}
                    data-testid="rolling-week-divider-right"
                />
            )}
        </>
    );
}

interface TodayHighlightProps {
    todayIndex: number;
    gridDims: GridDims;
    hoursCount: number;
    hasRolling: boolean;
    currentHour?: number;
    rangeStart: number;
}

export function TodayHighlight({
    todayIndex,
    gridDims,
    hoursCount,
    hasRolling,
    currentHour,
    rangeStart,
}: TodayHighlightProps) {
    const colGap = gridDims.colWidth + 1;
    const colLeft = gridDims.colStartLeft + todayIndex * colGap;
    const totalHeight = hoursCount * gridDims.rowHeight;

    if (hasRolling && currentHour !== undefined) {
        const relativeHour = currentHour - rangeStart;
        const splitY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));
        return (
            <>
                {splitY > 0 && (
                    <div
                        className="absolute z-[5] pointer-events-none rounded-sm"
                        style={{
                            top: gridDims.headerHeight,
                            left: colLeft,
                            width: gridDims.colWidth,
                            height: splitY,
                            background: 'var(--gt-past-highlight)',
                        }}
                        data-testid="today-highlight-past"
                    />
                )}
                {splitY < totalHeight && (
                    <div
                        className="absolute z-[5] pointer-events-none rounded-sm"
                        style={{
                            top: gridDims.headerHeight + splitY,
                            left: colLeft,
                            width: gridDims.colWidth,
                            height: totalHeight - splitY,
                            background: 'rgba(16, 185, 129, 0.05)',
                        }}
                        data-testid="today-highlight"
                    />
                )}
            </>
        );
    }

    return (
        <div
            className="absolute z-[5] pointer-events-none rounded-sm"
            style={{
                top: gridDims.headerHeight,
                left: colLeft,
                width: gridDims.colWidth,
                height: totalHeight,
                background: 'rgba(16, 185, 129, 0.05)',
            }}
            data-testid="today-highlight"
        />
    );
}

interface CurrentTimeIndicatorProps {
    todayIndex: number;
    currentHour: number;
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
}

export function CurrentTimeIndicator({
    todayIndex,
    currentHour,
    gridDims,
    rangeStart,
    rangeEnd,
}: CurrentTimeIndicatorProps) {
    const relativeHour = currentHour - rangeStart;
    if (relativeHour < 0 || relativeHour > rangeEnd - rangeStart) return null;
    const top = gridDims.headerHeight + relativeHour * gridDims.rowHeight;
    const colGap = gridDims.colWidth + 1;
    const left = gridDims.colStartLeft + todayIndex * colGap;

    return (
        <div
            className="absolute z-[25] pointer-events-none"
            style={{ top: top - 1, left: left - 4, width: gridDims.colWidth + 8, height: 0 }}
            data-testid="current-time-indicator"
        >
            <div
                className="absolute rounded-full"
                style={{
                    width: 8, height: 8, top: -3, left: 0,
                    background: '#ef4444',
                    boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
                }}
            />
            <div
                className="absolute"
                style={{
                    top: 0, left: 4, right: 0, height: 2,
                    background: '#ef4444',
                    boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
                }}
            />
        </div>
    );
}

interface EventBlockOverlaysProps {
    displayEvents: GameTimeEventBlock[];
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
    onEventClick?: (event: GameTimeEventBlock, anchorRect: DOMRect) => void;
}

export function EventBlockOverlays({
    displayEvents,
    gridDims,
    rangeStart,
    rangeEnd,
    onEventClick,
}: EventBlockOverlaysProps) {
    const dayEventCounts = new Map<string, number>();

    return (
        <>
            {displayEvents.map((ev) => {
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

                const left = gridDims.colStartLeft + ev.dayOfWeek * colGap + stackOffset;
                const width = gridDims.colWidth - stackOffset;

                return (
                    <div
                        key={`event-${ev.eventId}-${ev.dayOfWeek}`}
                        className="absolute z-20 rounded-sm overflow-hidden cursor-pointer hover:brightness-110 transition-all"
                        style={{
                            top, left,
                            width: Math.max(width, 0),
                            height: Math.max(height, 0),
                            ...getGameTimeBlockStyle(ev.gameSlug ?? undefined, ev.coverUrl),
                        }}
                        data-testid={`event-block-${ev.eventId}-${ev.dayOfWeek}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onEventClick?.(ev, (e.currentTarget as HTMLElement).getBoundingClientRect());
                        }}
                        title={`${ev.title}${ev.gameName ? ` (${ev.gameName})` : ''}`}
                    >
                        <RichEventBlock
                            event={{
                                title: ev.title,
                                gameName: ev.gameName,
                                gameSlug: ev.gameSlug,
                                gameId: ev.gameId,
                                coverUrl: ev.coverUrl,
                                startHour: ev.startHour,
                                endHour: ev.endHour,
                                description: ev.description,
                                creatorUsername: ev.creatorUsername,
                                signupsPreview: ev.signupsPreview,
                                signupCount: ev.signupCount,
                            }}
                            spanHours={ev.endHour - ev.startHour}
                        />
                    </div>
                );
            })}
        </>
    );
}

interface PreviewBlockOverlaysProps {
    previewBlocks: GameTimePreviewBlock[];
    displayEvents: GameTimeEventBlock[];
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
}

export function PreviewBlockOverlays({
    previewBlocks,
    displayEvents,
    gridDims,
    rangeStart,
    rangeEnd,
}: PreviewBlockOverlaysProps) {
    return (
        <>
            {previewBlocks.map((block, i) => {
                const visStart = Math.max(block.startHour, rangeStart);
                const visEnd = Math.min(block.endHour, rangeEnd);
                if (visStart >= visEnd) return null;

                const spanHours = visEnd - visStart;
                const top = gridDims.headerHeight + (visStart - rangeStart) * gridDims.rowHeight;
                const height = spanHours * gridDims.rowHeight - 1;
                const colGap = gridDims.colWidth + 1;
                const left = gridDims.colStartLeft + block.dayOfWeek * colGap;
                const width = gridDims.colWidth;

                const hasEventUnderneath = displayEvents.some(
                    (ev) => ev.dayOfWeek === block.dayOfWeek && ev.startHour < block.endHour && ev.endHour > block.startHour,
                );

                const isSelected = block.variant === 'selected';
                const borderStyle = isSelected
                    ? '3px solid rgba(6, 182, 212, 0.95)'
                    : '3px dashed rgba(6, 182, 212, 0.85)';
                const shadowStyle = '0 0 14px rgba(6, 182, 212, 0.4), inset 0 0 8px rgba(6, 182, 212, 0.1)';

                return (
                    <div
                        key={`preview-${block.dayOfWeek}-${block.startHour}-${i}`}
                        className="absolute z-[21] rounded-sm pointer-events-none"
                        style={{
                            top, left,
                            width: Math.max(width, 0),
                            height: Math.max(height, 0),
                            border: borderStyle,
                            boxShadow: shadowStyle,
                        }}
                        data-testid={`preview-block-${block.dayOfWeek}-${block.startHour}`}
                    >
                        {!hasEventUnderneath && block.title && (
                            <RichEventBlock
                                event={{
                                    title: block.title ?? block.label ?? 'Event',
                                    gameName: block.gameName,
                                    gameSlug: block.gameSlug,
                                    coverUrl: block.coverUrl,
                                    startHour: block.startHour,
                                    endHour: block.endHour,
                                    description: block.description,
                                    creatorUsername: block.creatorUsername,
                                    signupsPreview: block.attendees,
                                    signupCount: block.attendeeCount,
                                }}
                                spanHours={block.endHour - block.startHour}
                            />
                        )}
                    </div>
                );
            })}
        </>
    );
}

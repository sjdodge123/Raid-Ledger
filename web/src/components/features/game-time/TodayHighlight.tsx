import type { JSX } from 'react';
import type { GridDims } from './game-time-grid.types';

interface TodayHighlightProps {
    todayIndex: number;
    gridDims: GridDims;
    hoursCount: number;
    hasRolling: boolean;
    currentHour?: number;
    rangeStart: number;
}

/** Column highlight overlay for today's column in the game-time grid */
export function TodayHighlight({
    todayIndex, gridDims, hoursCount, hasRolling, currentHour, rangeStart,
}: TodayHighlightProps): JSX.Element | null {
    const colGap = gridDims.colWidth + 1;
    const colLeft = gridDims.colStartLeft + todayIndex * colGap;
    const totalHeight = hoursCount * gridDims.rowHeight;

    if (hasRolling && currentHour !== undefined) {
        const relativeHour = currentHour - rangeStart;
        const splitY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));
        return (
            <SplitHighlight
                colLeft={colLeft} colWidth={gridDims.colWidth}
                headerHeight={gridDims.headerHeight}
                totalHeight={totalHeight} splitY={splitY}
            />
        );
    }

    return (
        <HighlightPanel
            top={gridDims.headerHeight} left={colLeft}
            width={gridDims.colWidth} height={totalHeight}
            bg="rgba(16, 185, 129, 0.05)" testId="today-highlight"
        />
    );
}

function SplitHighlight({ colLeft, colWidth, headerHeight, totalHeight, splitY }: {
    colLeft: number; colWidth: number; headerHeight: number;
    totalHeight: number; splitY: number;
}): JSX.Element {
    return (
        <>
            {splitY > 0 && (
                <HighlightPanel
                    top={headerHeight} left={colLeft} width={colWidth} height={splitY}
                    bg="var(--gt-past-highlight)" testId="today-highlight-past"
                />
            )}
            {splitY < totalHeight && (
                <HighlightPanel
                    top={headerHeight + splitY} left={colLeft} width={colWidth}
                    height={totalHeight - splitY} bg="rgba(16, 185, 129, 0.05)" testId="today-highlight"
                />
            )}
        </>
    );
}

function HighlightPanel({ top, left, width, height, bg, testId }: {
    top: number; left: number; width: number; height: number; bg: string; testId: string;
}): JSX.Element {
    return (
        <div
            className="absolute z-[5] pointer-events-none rounded-sm"
            style={{ top, left, width, height, background: bg }}
            data-testid={testId}
        />
    );
}

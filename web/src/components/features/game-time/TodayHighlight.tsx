import type { JSX } from 'react';
import type { GridDims } from './game-time-grid.types';

interface TodayHighlightProps {
    todayIndex: number;
    gridDims: GridDims;
    hoursCount: number;
}

/** Column highlight overlay for today's column in the game-time grid */
export function TodayHighlight({
    todayIndex, gridDims, hoursCount,
}: TodayHighlightProps): JSX.Element | null {
    const colGap = gridDims.colWidth + 1;
    const colLeft = gridDims.colStartLeft + todayIndex * colGap;
    const totalHeight = hoursCount * gridDims.rowHeight;

    return (
        <HighlightPanel
            top={gridDims.headerHeight} left={colLeft}
            width={gridDims.colWidth} height={totalHeight}
            bg="rgba(16, 185, 129, 0.05)" testId="today-highlight"
        />
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

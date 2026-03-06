import type { JSX } from 'react';
import type { GridDims } from './game-time-grid.types';

interface CurrentTimeIndicatorProps {
    todayIndex: number;
    currentHour: number;
    gridDims: GridDims;
    rangeStart: number;
    rangeEnd: number;
}

/** Red dot + line showing the current time position on the grid */
export function CurrentTimeIndicator({
    todayIndex, currentHour, gridDims, rangeStart, rangeEnd,
}: CurrentTimeIndicatorProps): JSX.Element | null {
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
            <TimeDot />
            <TimeLine />
        </div>
    );
}

function TimeDot(): JSX.Element {
    return (
        <div
            className="absolute rounded-full"
            style={{
                width: 8, height: 8, top: -3, left: 0,
                background: '#ef4444',
                boxShadow: '0 0 6px rgba(239, 68, 68, 0.6)',
            }}
        />
    );
}

function TimeLine(): JSX.Element {
    return (
        <div
            className="absolute"
            style={{
                top: 0, left: 4, right: 0, height: 2,
                background: '#ef4444',
                boxShadow: '0 0 8px rgba(239, 68, 68, 0.6)',
            }}
        />
    );
}

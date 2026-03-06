import type { GridDims } from './game-time-grid.types';

interface RollingWeekDividerProps {
    todayIndex: number;
    gridDims: GridDims;
    currentHour: number;
    hoursCount: number;
    rangeStart: number;
}

/** Computes divider geometry from grid dims and time position */
function computeDivider(todayIndex: number, gridDims: GridDims, currentHour: number, hoursCount: number, rangeStart: number) {
    const totalHeight = hoursCount * gridDims.rowHeight;
    const relativeHour = currentHour - rangeStart;
    const redLineY = Math.max(0, Math.min(totalHeight, relativeHour * gridDims.rowHeight));
    const colGap = gridDims.colWidth + 1;
    const todayLeft = gridDims.colStartLeft + todayIndex * colGap;
    const todayRight = todayLeft + colGap;
    return { totalHeight, redLineY, todayLeft, todayRight, colGap, headerTop: gridDims.headerHeight };
}

/** Dashed divider line separating "past" rolling-week cells from "future" cells */
export function RollingWeekDivider({ todayIndex, gridDims, currentHour, hoursCount, rangeStart }: RollingWeekDividerProps): JSX.Element {
    const { totalHeight, redLineY, todayLeft, todayRight, colGap, headerTop } = computeDivider(todayIndex, gridDims, currentHour, hoursCount, rangeStart);
    const bs = '2px dashed rgba(148, 163, 184, 0.3)';

    return (
        <>
            {todayIndex > 0 && redLineY < totalHeight && (
                <Seg top={headerTop + redLineY} left={todayLeft - 1} w={0} h={totalHeight - redLineY} side="borderLeft" bs={bs} tid="rolling-week-divider-left" />
            )}
            {redLineY > 0 && (
                <Seg top={headerTop + redLineY} left={todayIndex > 0 ? todayLeft - 1 : todayLeft} w={todayIndex > 0 ? todayRight - todayLeft : colGap} h={0} side="borderTop" bs={bs} tid="rolling-week-divider-bottom" />
            )}
            {redLineY > 0 && (
                <Seg top={headerTop} left={todayRight - 1} w={0} h={redLineY} side="borderLeft" bs={bs} tid="rolling-week-divider-right" />
            )}
        </>
    );
}

/** Single positioned divider segment */
function Seg({ top, left, w, h, side, bs, tid }: {
    top: number; left: number; w: number; h: number;
    side: 'borderLeft' | 'borderTop'; bs: string; tid: string;
}): JSX.Element {
    return (
        <div
            className="absolute z-[6] pointer-events-none"
            style={{ top, left, width: w, height: h, [side]: bs }}
            data-testid={tid}
        />
    );
}

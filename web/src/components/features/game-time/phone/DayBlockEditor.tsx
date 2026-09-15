import { Fragment, useCallback, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { formatHour } from '../game-time-grid.utils';
import { deriveBlocks } from '../slot-blocks.utils';
import { useBlockEditor } from '../use-block-editor';
import { SlotBlockLayer } from '../SlotBlockLayer';
import { SelectedBlockInspector } from '../SelectedBlockInspector';

/** Width of the hour gutter, matching the comp's 52px. */
const GUTTER = 52;
/** Same hatch as the week strip — see `WeekStrip.HATCH`. */
const HATCH = 'repeating-linear-gradient(135deg, currentColor 0 4px, transparent 4px 8px)';

interface DayBlockEditorProps {
    slots: GameTimeSlot[];
    onChange?: (slots: GameTimeSlot[]) => void;
    /** The one day rendered, grid convention (0 = Sunday). */
    dayOfWeek: number;
    hours: number[];
    /** Hatch the unclaimed hours — the viewer's saved week is older than the freshness window. */
    stale?: boolean;
    /**
     * Pre-measured dims. Elements are zero-sized in jsdom, so tests (and any
     * caller that already measures) pass them instead of waiting for the
     * layout pass.
     */
    dims?: GridDims;
}

/**
 * ONE day of the ROK-1426 block editor, sized to fill its container (ROK-1569).
 *
 * The rows stretch (`grid-auto-rows: 1fr`) rather than taking a fixed height,
 * which is what keeps the evening hours on a 375×812 screen with no inner
 * scroll — a scroll inside the sheet is the thing this layout exists to avoid.
 * Everything else is the shipped editor: blocks with handles, `touch-action:
 * pan-y` everywhere except a selected block, and slots as the only state.
 */
export function DayBlockEditor({
    slots, onChange, dayOfWeek, hours, stale = false, dims,
}: DayBlockEditorProps): JSX.Element {
    const cellRef = useRef<HTMLDivElement | null>(null);
    const measured = useMeasuredDims(cellRef, dims);
    const editor = useBlockEditor(slots, onChange, hours, measured.rowHeight || undefined);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1" data-testid="phone-day-grid">
                <HourGrid hours={hours} dayOfWeek={dayOfWeek} stale={stale} cellRef={cellRef} />
                <SlotBlockLayer
                    blocks={deriveBlocks(slots, dayOfWeek, hours)}
                    editor={editor}
                    gridDims={measured}
                    hours={hours}
                    days={[dayOfWeek]}
                />
            </div>
            {/* The shipped inspector (Remove + Start/End steppers — the precise,
                accessible resize path). It takes a row under the day: the rows
                above shrink (they are 1fr) so nothing scrolls inside the sheet,
                and its own `sticky bottom` keeps it on screen when the profile
                page's taller box runs below the fold (ROK-1569 lane D finding:
                without it a phone user could not delete a block at all). */}
            {editor.selection && (
                <div data-testid="phone-block-inspector">
                    <SelectedBlockInspector
                        selection={editor.selection} slots={slots} hours={hours}
                        onAdjust={editor.adjust} onRemove={editor.removeSelected} onDone={editor.clearSelection}
                    />
                </div>
            )}
        </div>
    );
}

/** The hour gutter and the day's cells; rows stretch to fill the sheet. */
function HourGrid({ hours, dayOfWeek, stale, cellRef }: {
    hours: number[]; dayOfWeek: number; stale: boolean; cellRef: React.RefObject<HTMLDivElement | null>;
}): JSX.Element {
    return (
        <div
            className="grid h-full min-h-0 select-none"
            style={{ gridTemplateColumns: `${GUTTER}px 1fr`, gridAutoRows: '1fr', touchAction: 'pan-y' }}
        >
            {hours.map((hour, i) => (
                <Fragment key={hour}>
                    <div className="flex items-center justify-end pr-2 text-xs text-dim" data-testid={`phone-hour-${hour}`}>
                        {formatHour(hour)}
                    </div>
                    <div
                        ref={i === 0 ? cellRef : undefined}
                        className="border-t border-edge bg-surface text-amber-400"
                        style={stale ? { backgroundImage: HATCH } : undefined}
                        data-testid={`phone-cell-${dayOfWeek}-${hour}`}
                    />
                </Fragment>
            ))}
        </div>
    );
}

const ZERO: GridDims = { colWidth: 0, rowHeight: 0, headerHeight: 0, colStartLeft: 0 };

/**
 * Measure the first cell so the block layer can place blocks over it.
 *
 * Rows are `1fr`, so their height is only known after layout and changes with
 * the sheet — a ResizeObserver, not a one-shot read.
 */
function useMeasuredDims(cellRef: React.RefObject<HTMLDivElement | null>, override?: GridDims): GridDims {
    const [dims, setDims] = useState<GridDims>(override ?? ZERO);

    const measure = useCallback(() => {
        const cell = cellRef.current;
        if (!cell) return;
        setDims((prev) => {
            const next: GridDims = {
                colWidth: cell.offsetWidth, rowHeight: cell.offsetHeight,
                headerHeight: cell.offsetTop, colStartLeft: cell.offsetLeft,
            };
            const same = (Object.keys(next) as (keyof GridDims)[]).every((k) => prev[k] === next[k]);
            return same ? prev : next;
        });
    }, [cellRef]);

    useLayoutEffect(() => {
        if (override || typeof ResizeObserver === 'undefined') return;
        measure();
        const ro = new ResizeObserver(measure);
        if (cellRef.current) ro.observe(cellRef.current);
        return () => ro.disconnect();
    }, [override, measure, cellRef]);

    return override ?? dims;
}

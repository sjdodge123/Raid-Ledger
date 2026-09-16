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

interface DayBlockEditorProps {
    slots: GameTimeSlot[];
    onChange?: (slots: GameTimeSlot[]) => void;
    /** The one day rendered, grid convention (0 = Sunday). */
    dayOfWeek: number;
    hours: number[];
    /**
     * Pre-measured dims. Elements are zero-sized in jsdom, so tests (and any
     * caller that already measures) pass them instead of waiting for the
     * layout pass.
     */
    dims?: GridDims;
    /**
     * Where the selected block's inspector goes. `flow` (default) puts it
     * under the day inside a bounded box — the sheet. `fixed` pins it above
     * the phone tab bar for a box taller than the viewport — the profile
     * page, whose 17-hour day scrolls with the page, so an in-flow inspector
     * landed at y=890 in a 671px viewport (fleet gate, ROK-1569).
     */
    inspectorPlacement?: 'flow' | 'fixed';
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
const FIXED_INSPECTOR = 'fixed inset-x-4 z-30 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)]';

export function DayBlockEditor({
    slots, onChange, dayOfWeek, hours, dims, inspectorPlacement = 'flow',
}: DayBlockEditorProps): JSX.Element {
    const cellRef = useRef<HTMLDivElement | null>(null);
    const measured = useMeasuredDims(cellRef, dims);
    const editor = useBlockEditor(slots, onChange, hours, measured.rowHeight || undefined);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1" data-testid="phone-day-grid">
                <HourGrid hours={hours} dayOfWeek={dayOfWeek} cellRef={cellRef} />
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
                <div
                    data-testid="phone-block-inspector"
                    data-placement={inspectorPlacement}
                    className={inspectorPlacement === 'fixed' ? FIXED_INSPECTOR : undefined}
                >
                    <SelectedBlockInspector
                        selection={editor.selection} slots={slots} hours={hours}
                        onAdjust={editor.adjust} onRemove={editor.removeSelected} onDone={editor.clearSelection}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * The hour gutter and the day's cells; rows stretch to fill the sheet.
 *
 * An unclaimed hour is a plain surface. ROK-1569 hatched it whenever the saved
 * week was stale; the operator ruled the cross-hatch out on 2026-09-16, and the
 * prompt above the editor is what says the week is old.
 */
function HourGrid({ hours, dayOfWeek, cellRef }: {
    hours: number[]; dayOfWeek: number; cellRef: React.RefObject<HTMLDivElement | null>;
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
                        className="border-t border-edge bg-surface"
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

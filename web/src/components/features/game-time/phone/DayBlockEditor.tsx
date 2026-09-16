import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { formatHour } from '../game-time-grid.utils';
import { deriveBlocks } from '../slot-blocks.utils';
import { useBlockEditor, type BlockEditorApi } from '../use-block-editor';
import { SlotBlockLayer } from '../SlotBlockLayer';
import { SelectedBlockInspector } from '../SelectedBlockInspector';
import { presetIndices, type BlockPreset, type BlockPresetControl } from '../block-presets';

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
    /** Coarse block presets and the window negotiation behind them (ROK-1579). */
    presets?: BlockPresetControl;
}

/**
 * ONE day of the ROK-1426 block editor, sized to fill its container (ROK-1569).
 *
 * The rows stretch (`minmax(44px, 1fr)`) rather than taking a fixed height, so
 * the check's seven evening hours fill a 375×812 sheet with no inner scroll —
 * that is what this layout exists for. ROK-1579 added the 44px floor and made
 * the day its own scroll container: the profile's 17 hours cannot stretch thin
 * enough to fit, and squeezing them collapsed the grid to nothing the moment the
 * absence panel opened (labels painting over the week strip). Now the day gives
 * up height down to its slot's floor and SCROLLS instead of collapsing.
 * Everything else is the shipped editor: blocks with handles, `touch-action:
 * pan-y` everywhere except a selected block, and slots as the only state.
 */
const FIXED_INSPECTOR = 'fixed inset-x-4 z-30 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)]';

export function DayBlockEditor({
    slots, onChange, dayOfWeek, hours, dims, inspectorPlacement = 'flow', presets,
}: DayBlockEditorProps): JSX.Element {
    const cellRef = useRef<HTMLDivElement | null>(null);
    const measured = useMeasuredDims(cellRef, dims);
    const editor = useBlockEditor(slots, onChange, hours, measured.rowHeight || undefined);
    const applyPreset = usePresetApply(editor, hours, presets);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <ScrollingDay
                slots={slots} dayOfWeek={dayOfWeek} hours={hours}
                editor={editor} dims={measured} cellRef={cellRef}
            />
            {/* The shipped inspector (Remove + Start/End steppers — the precise,
                accessible resize path). It takes a row UNDER the day: the day
                gives up the height for it (and scrolls if it must), so nothing
                overlaps, and its own `sticky bottom` keeps it on screen (ROK-1569
                lane D: without it a phone user could not delete a block at all). */}
            {editor.selection && (
                <div
                    data-testid="phone-block-inspector"
                    data-placement={inspectorPlacement}
                    className={inspectorPlacement === 'fixed' ? FIXED_INSPECTOR : undefined}
                >
                    <SelectedBlockInspector
                        selection={editor.selection} slots={slots} hours={hours}
                        onAdjust={editor.adjust} onRemove={editor.removeSelected} onDone={editor.clearSelection}
                        presets={presets?.list} onPreset={applyPreset}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Apply a preset, or park it until the window reaches its start hour.
 *
 * "Whole day" starts at 9 AM, which the fitted window does not show, so the
 * chip cannot resolve to an index yet. It asks the mount for room; the mount
 * expands and hands the preset back as `pending`, and this effect applies it on
 * the render where the hour finally exists. The selection survives that change
 * because `useBlockEditor` re-indexes it by hour (`remapSelection`).
 */
function usePresetApply(
    editor: BlockEditorApi, hours: number[], presets?: BlockPresetControl,
): (preset: BlockPreset) => void {
    const pending = presets?.pending ?? null;
    useEffect(() => {
        if (!pending || !editor.selection) return;
        const range = presetIndices(hours, pending);
        if (!range) return;
        editor.setBounds(range.start, range.end);
        presets?.onApplied();
    }, [pending, hours, editor, presets]);

    return useCallback((preset: BlockPreset) => {
        const range = presetIndices(hours, preset);
        if (range) editor.setBounds(range.start, range.end);
        else presets?.onNeedsRoom(preset);
    }, [hours, editor, presets]);
}

/**
 * The day itself: the cells, the blocks over them, and the scroll that keeps
 * both reachable.
 *
 * The scroller and the content are two elements on purpose. `SlotBlockLayer` is
 * `absolute inset-0`, so it resolves against the nearest positioned ancestor —
 * against the SCROLLER it would be the clipped box (blocks below the fold
 * detached from their cells), against the content wrapper it is the full
 * scrollable day, and the blocks scroll with the hours they sit on.
 */
function ScrollingDay({ slots, dayOfWeek, hours, editor, dims, cellRef }: {
    slots: GameTimeSlot[]; dayOfWeek: number; hours: number[];
    editor: BlockEditorApi; dims: GridDims; cellRef: React.RefObject<HTMLDivElement | null>;
}): JSX.Element {
    return (
        <div
            className="relative min-h-0 flex-1 overflow-y-auto"
            style={{ touchAction: 'pan-y' }}
            data-testid="phone-day-grid"
        >
            <div className="relative flex min-h-full flex-col">
                <HourGrid hours={hours} dayOfWeek={dayOfWeek} cellRef={cellRef} />
                <SlotBlockLayer
                    blocks={deriveBlocks(slots, dayOfWeek, hours)}
                    editor={editor}
                    gridDims={dims}
                    hours={hours}
                    days={[dayOfWeek]}
                />
            </div>
        </div>
    );
}

/**
 * The hour gutter and the day's cells; rows fill the sheet, never below 44px.
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
            className="grid flex-1 select-none"
            style={{
                gridTemplateColumns: `${GUTTER}px 1fr`,
                gridAutoRows: 'minmax(44px, 1fr)',
                touchAction: 'pan-y',
            }}
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
 * Rows are `minmax(44px, 1fr)`, so their height is only known after layout and
 * changes with the sheet — a ResizeObserver, not a one-shot read.
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

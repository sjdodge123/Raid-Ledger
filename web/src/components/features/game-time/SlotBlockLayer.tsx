import type { JSX } from 'react';
import type { GridDims } from './game-time-grid.types';
import type { SlotBlock } from './slot-blocks.utils';
import type { BlockEditorApi } from './use-block-editor';
import { DAYS, formatHour } from './game-time-grid.utils';

/** Minimum width a selected block expands to, so its handles clear a fingertip. */
const SELECTED_MIN_WIDTH = 56;
/** Height of the resize strips at each end of a selected block. */
const HANDLE_HEIGHT = 16;

const colLeftOf = (dims: GridDims, day: number): number =>
    dims.colStartLeft + day * (dims.colWidth + 1);

/** A selected block widens over its neighbours, staying inside the grid. */
function selectedGeometry(dims: GridDims, day: number): { left: number; width: number } {
    const width = Math.max(dims.colWidth, SELECTED_MIN_WIDTH);
    const centre = colLeftOf(dims, day) + dims.colWidth / 2;
    const maxLeft = colLeftOf(dims, 6) + dims.colWidth - width;
    return { left: Math.max(dims.colStartLeft, Math.min(maxLeft, centre - width / 2)), width };
}

function blockLabel(block: SlotBlock, hours: number[]): string {
    const endHour = block.endIndex >= hours.length
        ? (hours[hours.length - 1] + 1) % 24
        : hours[block.endIndex];
    return `${DAYS[block.dayOfWeek]} ${formatHour(hours[block.startIndex])} to ${formatHour(endHour)}`;
}

interface SlotBlockLayerProps {
    blocks: SlotBlock[];
    editor: BlockEditorApi;
    gridDims: GridDims;
    hours: number[];
}

/**
 * Interactive block layer for the game-time editor (ROK-1426).
 *
 * Sits above the cell grid and owns every editing gesture. The container is
 * pointer-events:none so only the day columns and blocks are targets, and the
 * day columns keep touch-action:pan-y — the page scrolls from anywhere except a
 * selected block and its handles.
 */
export function SlotBlockLayer({ blocks, editor, gridDims, hours }: SlotBlockLayerProps): JSX.Element {
    return (
        <div
            className="absolute inset-0 z-[8]"
            style={{ pointerEvents: 'none' }}
            onPointerMove={editor.handleMove}
            onPointerUp={editor.handleUp}
            onPointerCancel={editor.handleCancel}
            data-testid="block-editor-layer"
        >
            {DAYS.map((_, day) => (
                <DayTarget key={`col-${day}`} day={day} editor={editor} gridDims={gridDims} hours={hours} />
            ))}
            {blocks.map((block) => (
                <Block
                    key={`blk-${block.dayOfWeek}-${block.startIndex}`}
                    block={block} editor={editor} gridDims={gridDims} hours={hours}
                />
            ))}
        </div>
    );
}

/** Empty-space target for one day: a tap here drops a new block. */
function DayTarget({ day, editor, gridDims, hours }: {
    day: number; editor: BlockEditorApi; gridDims: GridDims; hours: number[];
}): JSX.Element {
    const onPointerDown = (e: React.PointerEvent): void => {
        const rect = e.currentTarget.getBoundingClientRect();
        const index = Math.floor((e.clientY - rect.top) / gridDims.rowHeight);
        if (index < 0 || index >= hours.length) return;
        editor.beginEmpty(e, day, index);
    };
    return (
        <div
            className="absolute"
            style={{
                top: gridDims.headerHeight, left: colLeftOf(gridDims, day),
                width: gridDims.colWidth, height: hours.length * gridDims.rowHeight,
                pointerEvents: 'auto', touchAction: 'pan-y',
            }}
            onPointerDown={onPointerDown}
            data-testid={`slot-day-target-${day}`}
        />
    );
}

function Block({ block, editor, gridDims, hours }: {
    block: SlotBlock; editor: BlockEditorApi; gridDims: GridDims; hours: number[];
}): JSX.Element {
    // Test ids key on the START HOUR, not the index: the visible range varies by
    // surface ([9, 2] on the profile, [6, 24] in the refresh modal), so an index
    // means something different in each one.
    const sel = editor.selection;
    const isSelected = !!sel && sel.dayOfWeek === block.dayOfWeek
        && sel.startIndex === block.startIndex && sel.endIndex === block.endIndex;
    const geo = isSelected
        ? selectedGeometry(gridDims, block.dayOfWeek)
        : { left: colLeftOf(gridDims, block.dayOfWeek), width: gridDims.colWidth };

    return (
        <div
            role="button" tabIndex={0}
            aria-pressed={isSelected}
            aria-label={blockLabel(block, hours)}
            className={`absolute rounded-sm transition-[box-shadow,background-color,width,left] duration-150 motion-reduce:transition-none ${
                isSelected
                    ? 'bg-emerald-500/95 ring-2 ring-emerald-400 shadow-[0_0_14px_2px_rgba(52,211,153,0.45)] cursor-grab'
                    : 'bg-emerald-500/70 cursor-pointer'
            }`}
            style={{
                top: gridDims.headerHeight + block.startIndex * gridDims.rowHeight + 1,
                left: geo.left, width: geo.width,
                height: (block.endIndex - block.startIndex) * gridDims.rowHeight - 3,
                zIndex: isSelected ? 3 : 1,
                pointerEvents: 'auto',
                touchAction: isSelected ? 'none' : 'pan-y',
            }}
            onPointerDown={(e) => editor.beginBlock(e, block)}
            onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                if (isSelected) editor.clearSelection(); else editor.beginBlock(e as unknown as React.PointerEvent, block);
            }}
            data-testid={`slot-block-${block.dayOfWeek}-${hours[block.startIndex]}`}
            data-selected={isSelected ? 'true' : undefined}
        >
            {isSelected && <Handle block={block} editor={editor} edge="start" hours={hours} />}
            {isSelected && <Handle block={block} editor={editor} edge="end" hours={hours} />}
        </div>
    );
}

/**
 * The only elements in the whole grid that set `touch-action: none`. Everything
 * else stays pan-y, which is why the page scrolls from inside the editor.
 */
function Handle({ block, editor, edge, hours }: {
    block: SlotBlock; editor: BlockEditorApi; edge: 'start' | 'end'; hours: number[];
}): JSX.Element {
    return (
        <div
            className="absolute left-0 right-0 flex items-center justify-center cursor-ns-resize"
            style={{
                [edge === 'start' ? 'top' : 'bottom']: -HANDLE_HEIGHT / 2,
                height: HANDLE_HEIGHT, touchAction: 'none',
            }}
            onPointerDown={(e) => editor.beginHandle(e, block, edge)}
            data-testid={`slot-handle-${edge}-${block.dayOfWeek}-${hours[block.startIndex]}`}
        >
            <span className="w-4 h-[3px] rounded-full bg-emerald-300 ring-[1.5px] ring-panel" />
        </div>
    );
}

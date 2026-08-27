import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from './game-time-grid.types';
import { deriveAllBlocks } from './slot-blocks.utils';
import { useBlockEditor } from './use-block-editor';
import { SlotBlockLayer } from './SlotBlockLayer';
import { SelectedBlockInspector } from './SelectedBlockInspector';

/**
 * Gesture coverage for the block editor (ROK-1426).
 *
 * jsdom reports every element as zero-sized, so GameTimeGrid's ResizeObserver
 * measurement yields a rowHeight of 0 and no drag could ever resolve. These
 * tests drive the layer with explicit dims instead, which is the only way to
 * exercise the pointer maths below a real browser.
 */
const ROW = 26;
const DIMS: GridDims = { colWidth: 40, rowHeight: ROW, headerHeight: 20, colStartLeft: 52 };
/** Profile-shaped evening range, so index != hour and the mapping is exercised. */
const HOURS = [19, 20, 21, 22, 23, 0, 1];

/** jsdom rects are all zeros, so clientY alone selects the row index. */
const yForIndex = (index: number): number => index * ROW + 5;

function Harness({ initial }: { initial: GameTimeSlot[] }) {
    const [slots, setSlots] = useState<GameTimeSlot[]>(initial);
    const editor = useBlockEditor(slots, setSlots, HOURS, ROW);
    return (
        <>
            <SlotBlockLayer blocks={deriveAllBlocks(slots, HOURS)} editor={editor} gridDims={DIMS} hours={HOURS} />
            {editor.selection && (
                <SelectedBlockInspector
                    selection={editor.selection} slots={slots} hours={HOURS}
                    onAdjust={editor.adjust} onRemove={editor.removeSelected} onDone={editor.clearSelection}
                />
            )}
            <output data-testid="slots">
                {slots.filter((s) => s.status === 'available')
                    .map((s) => `${s.dayOfWeek}:${s.hour}`).sort().join(',')}
            </output>
        </>
    );
}

const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));
const slotsText = (): string => screen.getByTestId('slots').textContent ?? '';
const layer = (): HTMLElement => screen.getByTestId('slot-block-layer');

describe('block editor — creating', () => {
    it('a tap on empty space drops a two-hour block', () => {
        render(<Harness initial={[]} />);
        const target = screen.getByTestId('slot-day-target-3');

        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: yForIndex(1) });
        fireEvent.pointerUp(layer(), { pointerId: 1, clientX: 10, clientY: yForIndex(1) });

        // Index 1 of [19,20,...] is 20:00, so the block covers 20 and 21.
        expect(slotsText()).toBe('3:20,3:21');
    });

    it('a drag on empty space creates nothing, leaving the page free to scroll', () => {
        render(<Harness initial={[]} />);
        const target = screen.getByTestId('slot-day-target-3');

        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: yForIndex(1) });
        fireEvent.pointerMove(layer(), { pointerId: 1, clientX: 10, clientY: yForIndex(1) + 60 });
        fireEvent.pointerUp(layer(), { pointerId: 1, clientX: 10, clientY: yForIndex(1) + 60 });

        expect(slotsText()).toBe('');
    });

    it('treats a browser-cancelled gesture as a scroll, not a tap', () => {
        render(<Harness initial={[]} />);
        const target = screen.getByTestId('slot-day-target-3');

        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: yForIndex(1) });
        fireEvent.pointerCancel(layer(), { pointerId: 1 });
        fireEvent.pointerUp(layer(), { pointerId: 1, clientX: 10, clientY: yForIndex(1) });

        expect(slotsText()).toBe('');
    });

    it('clamps a block created on the last row to the end of the range', () => {
        render(<Harness initial={[]} />);
        fireEvent.pointerDown(screen.getByTestId('slot-day-target-0'), { pointerId: 1, clientX: 10, clientY: yForIndex(6) });
        fireEvent.pointerUp(layer(), { pointerId: 1, clientX: 10, clientY: yForIndex(6) });

        expect(slotsText()).toBe('0:1');
    });
});

describe('block editor — selection', () => {
    it('a tap on a block selects it without changing anything', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        const block = screen.getByTestId('slot-block-2-20');

        fireEvent.pointerDown(block, { pointerId: 1, clientY: yForIndex(1) });
        fireEvent.pointerUp(layer(), { pointerId: 1, clientY: yForIndex(1) });

        expect(block).toHaveAttribute('data-selected', 'true');
        expect(slotsText()).toBe('2:20,2:21');
        expect(screen.getByTestId('selected-block-inspector')).toBeInTheDocument();
    });

    it('leaves an unselected block scroll-through and only opts out once selected', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        const block = screen.getByTestId('slot-block-2-20');
        expect(block).toHaveStyle({ touchAction: 'pan-y' });

        fireEvent.pointerDown(block, { pointerId: 1, clientY: yForIndex(1) });
        expect(block).toHaveStyle({ touchAction: 'none' });
    });

    it('widens the selected block past its column so the handles are reachable', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        const block = screen.getByTestId('slot-block-2-20');
        expect(block.style.width).toBe(`${DIMS.colWidth}px`);

        fireEvent.pointerDown(block, { pointerId: 1, clientY: yForIndex(1) });
        expect(parseFloat(block.style.width)).toBeGreaterThan(DIMS.colWidth);
    });

    it('shows handles only on the selected block', () => {
        render(<Harness initial={[...avail(2, [20]), ...avail(4, [22])]} />);
        expect(screen.queryByTestId('slot-handle-start-2-20')).not.toBeInTheDocument();

        fireEvent.pointerDown(screen.getByTestId('slot-block-2-20'), { pointerId: 1, clientY: yForIndex(1) });
        expect(screen.getByTestId('slot-handle-start-2-20')).toBeInTheDocument();
        expect(screen.queryByTestId('slot-handle-start-4-22')).not.toBeInTheDocument();
    });

    it('Done clears the selection', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        fireEvent.pointerDown(screen.getByTestId('slot-block-2-20'), { pointerId: 1, clientY: yForIndex(1) });
        fireEvent.click(screen.getByTestId('deselect-block'));
        expect(screen.queryByTestId('selected-block-inspector')).not.toBeInTheDocument();
    });
});

describe('block editor — resizing and moving', () => {
    const selectFirst = () => {
        const block = screen.getByTestId('slot-block-2-20');
        fireEvent.pointerDown(block, { pointerId: 1, clientY: yForIndex(1) });
        return block;
    };

    it('dragging the end handle down extends the block', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        selectFirst();

        const handle = screen.getByTestId('slot-handle-end-2-20');
        fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 + 2 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 + 2 * ROW });

        expect(slotsText()).toBe('2:20,2:21,2:22,2:23');
    });

    it('dragging the start handle up extends the block backwards', () => {
        render(<Harness initial={avail(2, [21])} />);
        fireEvent.pointerDown(screen.getByTestId('slot-block-2-21'), { pointerId: 1, clientY: yForIndex(2) });

        const handle = screen.getByTestId('slot-handle-start-2-21');
        fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 - 2 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 - 2 * ROW });

        expect(slotsText()).toBe('2:19,2:20,2:21');
    });

    it('a resize that meets a neighbour merges them and keeps the result selected', () => {
        render(<Harness initial={[...avail(2, [19]), ...avail(2, [21, 22])]} />);
        fireEvent.pointerDown(screen.getByTestId('slot-block-2-19'), { pointerId: 1, clientY: yForIndex(0) });

        const handle = screen.getByTestId('slot-handle-end-2-19');
        fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 + 1 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 + 1 * ROW });

        expect(slotsText()).toBe('2:19,2:20,2:21,2:22');
        expect(screen.getByTestId('slot-block-2-19')).toHaveAttribute('data-selected', 'true');
        expect(screen.getByTestId('start-value')).toHaveTextContent('7 PM');
        expect(screen.getByTestId('end-value')).toHaveTextContent('11 PM');
    });

    it('a second press on an already-selected block drags it, keeping its length', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        const block = selectFirst();

        fireEvent.pointerDown(block, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 + 2 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 + 2 * ROW });

        expect(slotsText()).toBe('2:22,2:23');
    });

    it('never shrinks a block below one hour', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        selectFirst();

        const handle = screen.getByTestId('slot-handle-end-2-20');
        fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 - 8 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 - 8 * ROW });

        expect(slotsText()).toBe('2:20');
    });

    it('stops a resize at a blocked hour instead of overwriting it', () => {
        const initial: GameTimeSlot[] = [
            ...avail(2, [20]),
            { dayOfWeek: 2, hour: 22, status: 'blocked' },
        ];
        render(<Harness initial={initial} />);
        fireEvent.pointerDown(screen.getByTestId('slot-block-2-20'), { pointerId: 1, clientY: yForIndex(1) });

        const handle = screen.getByTestId('slot-handle-end-2-20');
        fireEvent.pointerDown(handle, { pointerId: 2, clientY: 100 });
        fireEvent.pointerMove(layer(), { pointerId: 2, clientY: 100 + 4 * ROW });
        fireEvent.pointerUp(layer(), { pointerId: 2, clientY: 100 + 4 * ROW });

        expect(slotsText()).toBe('2:20,2:21');
    });
});

describe('selected-block inspector', () => {
    const selectBlock = (testId: string, index: number) =>
        fireEvent.pointerDown(screen.getByTestId(testId), { pointerId: 1, clientY: yForIndex(index) });

    it('shows the block bounds using the end hour, not the last hour', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        selectBlock('slot-block-2-20', 1);
        expect(screen.getByTestId('start-value')).toHaveTextContent('8 PM');
        expect(screen.getByTestId('end-value')).toHaveTextContent('10 PM');
    });

    it('the end stepper extends the block by an hour', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        selectBlock('slot-block-2-20', 1);
        fireEvent.click(screen.getByTestId('end-later'));
        expect(slotsText()).toBe('2:20,2:21,2:22');
    });

    it('the start stepper trims the block from the front', () => {
        render(<Harness initial={avail(2, [20, 21])} />);
        selectBlock('slot-block-2-20', 1);
        fireEvent.click(screen.getByTestId('start-later'));
        expect(slotsText()).toBe('2:21');
    });

    it('disables the steppers at the edges of the visible range', () => {
        render(<Harness initial={avail(2, [19])} />);
        selectBlock('slot-block-2-19', 0);
        expect(screen.getByTestId('start-earlier')).toBeDisabled();
        expect(screen.getByTestId('end-earlier')).toBeDisabled();
    });

    it('Remove deletes the block and drops the selection', () => {
        render(<Harness initial={[...avail(2, [20, 21]), ...avail(5, [23])]} />);
        selectBlock('slot-block-2-20', 1);
        fireEvent.click(screen.getByTestId('remove-block'));

        expect(slotsText()).toBe('5:23');
        expect(screen.queryByTestId('selected-block-inspector')).not.toBeInTheDocument();
    });
});

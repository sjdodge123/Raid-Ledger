/**
 * The phone week editor core (ROK-1569) — one day on screen, paged by arrows,
 * swipe or the week strip.
 *
 * jsdom reports every element as zero-sized, so the grid's own measurement
 * yields a rowHeight of 0 and no pointer maths could resolve. These tests pass
 * explicit dims, exactly as `SlotBlockLayer.test.tsx` does.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../../game-time-grid.types';
import { PhoneWeekEditorCore } from '../PhoneWeekEditorCore';

const ROW = 26;
const DIMS: GridDims = { colWidth: 300, rowHeight: ROW, headerHeight: 0, colStartLeft: 52 };
const HOURS = [17, 18, 19, 20, 21, 22, 23];
const yForIndex = (index: number): number => index * ROW + 5;
const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));

function Harness({ initial, initialDay = 2, onChange }: {
    initial: GameTimeSlot[]; initialDay?: number; onChange?: (s: GameTimeSlot[]) => void;
}) {
    const [slots, setSlots] = useState<GameTimeSlot[]>(initial);
    return (
        <>
            <PhoneWeekEditorCore
                slots={slots}
                onChange={(next) => { setSlots(next); onChange?.(next); }}
                hours={HOURS}
                initialDay={initialDay}
                dims={DIMS}
            />
            <output data-testid="slots">
                {slots.filter((s) => s.status === 'available').map((s) => `${s.dayOfWeek}:${s.hour}`).sort().join(',')}
            </output>
        </>
    );
}

const editorArea = (): HTMLElement => screen.getByTestId('phone-day-editor');
const swipe = (dx: number, dy = 0): void => {
    fireEvent.pointerDown(editorArea(), { pointerId: 9, clientX: 200, clientY: 400 });
    fireEvent.pointerUp(editorArea(), { pointerId: 9, clientX: 200 + dx, clientY: 400 + dy });
};

describe('PhoneWeekEditorCore — one day on screen', () => {
    it('renders only the chosen day’s blocks', () => {
        render(<Harness initial={[...avail(2, [19, 20]), ...avail(3, [21, 22])]} />);
        expect(screen.getByTestId('slot-block-2-19')).toBeInTheDocument();
        expect(screen.queryByTestId('slot-block-3-21')).not.toBeInTheDocument();
    });

    it('edits the day on screen and hands the caller the updated slots', () => {
        const onChange = vi.fn();
        render(<Harness initial={[]} onChange={onChange} />);
        const target = screen.getByTestId('slot-day-target-2');
        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: yForIndex(2) });
        fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: yForIndex(2) });
        // Index 2 of [17..23] is 19:00, and a tap drops the default two hours.
        expect(screen.getByTestId('slots')).toHaveTextContent('2:19,2:20');
        expect(onChange).toHaveBeenCalledWith([
            { dayOfWeek: 2, hour: 19, status: 'available' },
            { dayOfWeek: 2, hour: 20, status: 'available' },
        ]);
    });

    it('shows the hour gutter for the visible range only', () => {
        render(<Harness initial={[]} />);
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(HOURS.length);
    });
});

describe('PhoneWeekEditorCore — paging', () => {
    it('steps a day with the arrows and retitles the header', () => {
        render(<Harness initial={[]} />);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Tuesday');
        fireEvent.click(screen.getByLabelText('Next day'));
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Wednesday');
        fireEvent.click(screen.getByLabelText('Previous day'));
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Tuesday');
    });

    it('steps a day on a decisive horizontal swipe', () => {
        render(<Harness initial={[]} />);
        swipe(-90);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Wednesday');
        swipe(90);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Tuesday');
    });

    it('leaves the day alone when the drag is mostly vertical — that is a scroll', () => {
        render(<Harness initial={[]} />);
        swipe(-90, 80);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Tuesday');
    });

    it('clamps at Saturday instead of wrapping round to Sunday', () => {
        render(<Harness initial={[]} initialDay={6} />);
        swipe(-90);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Saturday');
    });

    it('clamps at Sunday instead of wrapping round to Saturday', () => {
        render(<Harness initial={[]} initialDay={0} />);
        swipe(90);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Sunday');
    });

    it('jumps to the day tapped in the week strip', () => {
        render(<Harness initial={[...avail(5, [19])]} />);
        fireEvent.click(screen.getByTestId('phone-week-strip-day-5'));
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Friday');
        expect(screen.getByTestId('slot-block-5-19')).toBeInTheDocument();
    });

    it('keeps the strip in step with the day being edited', () => {
        render(<Harness initial={[]} />);
        fireEvent.click(screen.getByLabelText('Next day'));
        expect(screen.getByTestId('phone-week-strip-day-3')).toHaveAttribute('aria-current', 'date');
    });
});

describe('PhoneWeekEditorCore — the selected block\'s inspector lives on the phone too (AC4)', () => {
    it('shows Remove + steppers over the day once a block is created, and Remove deletes it', () => {
        const onChange = vi.fn();
        render(<Harness initial={[]} onChange={onChange} />);
        const target = screen.getByTestId('slot-day-target-2');
        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: yForIndex(2) });
        fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: yForIndex(2) });
        expect(onChange).toHaveBeenCalled();

        // The new block is auto-selected, so the inspector overlays the grid.
        const inspector = screen.getByTestId('selected-block-inspector');
        expect(screen.getByTestId('phone-block-inspector')).toContainElement(inspector);
        expect(screen.getByTestId('remove-block')).toBeInTheDocument();
        expect(screen.getByTestId('start-later')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('remove-block'));
        const last = onChange.mock.calls.at(-1)?.[0] as Array<{ dayOfWeek: number; hour: number }>;
        expect(last.filter((s) => s.dayOfWeek === 2)).toHaveLength(0);
    });
});

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
import { PhoneWeekEditorCore, type GroupOverlay } from '../PhoneWeekEditorCore';
import { groupCellKey, toGroupCellMap } from '../group-day.utils';

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

/**
 * ROK-1579 — the drawer defect: with 17 hours in a fixed-height drawer the rows
 * shrank to ~19px, and when the absence panel opened the day grid collapsed to
 * ZERO height while its hour labels kept painting over the week strip. The
 * layout contract below is what stops both: the grid scrolls inside its own box
 * rather than squeezing, the rows never go under the 44px touch target, and the
 * pager and the strip keep their natural height.
 *
 * jsdom has no layout, so these assert the CSS contract (class + inline style),
 * not measured pixels — the pixels are the fleet Playwright gate's job.
 */
describe('PhoneWeekEditorCore — the day grid scrolls instead of collapsing (ROK-1579)', () => {
    it('makes the day grid its own scroll container, still pannable by touch', () => {
        render(<Harness initial={[]} />);
        const grid = screen.getByTestId('phone-day-grid');
        expect(grid.className).toContain('overflow-y-auto');
        expect(grid.className).toContain('flex-1');
        expect(grid.style.touchAction).toBe('pan-y');
    });

    it('floors the hour rows at the 44px touch target rather than stretching them thin', () => {
        render(<Harness initial={[]} />);
        const hourGrid = screen.getByTestId('phone-cell-2-17').parentElement!;
        expect(hourGrid.style.gridAutoRows).toBe('minmax(44px, 1fr)');
        // Still pan-y — the ROK-1426 regression this file guards.
        expect(hourGrid.style.touchAction).toBe('pan-y');
    });

    it('gives the grid slot a floor of three rows so it can never collapse to nothing', () => {
        render(<Harness initial={[]} />);
        const slot = screen.getByTestId('phone-day-editor');
        expect(slot.className).toContain('min-h-[132px]');
        expect(slot.className).not.toContain('min-h-0');
    });

    it('keeps the pager and the week strip at their natural height', () => {
        render(<Harness initial={[]} />);
        expect(screen.getByTestId('phone-day-pager').className).toContain('flex-none');
        expect(screen.getByTestId('phone-week-strip').className).toContain('flex-none');
    });

    it('sizes the block layer to the whole scrollable day, not the clipped box', () => {
        render(<Harness initial={[]} />);
        const layer = screen.getByTestId('block-editor-layer');
        const scroller = screen.getByTestId('phone-day-grid');
        // The layer is positioned against the content wrapper INSIDE the
        // scroller, so it scrolls with the cells and spans their full height.
        expect(layer.parentElement).not.toBe(scroller);
        expect(layer.parentElement!.className).toContain('relative');
        expect(layer.parentElement!.className).toContain('min-h-full');
        expect(scroller).toContainElement(layer);
    });
});
// ROK-1580: the same shell in GROUP mode — the poll's aggregate replaces the
// editable day, and the week no longer ends at Saturday because the pager can
// ask its caller for the next week.
describe('PhoneWeekEditorCore — group mode', () => {
    const CELLS = toGroupCellMap([
        ...[17, 18, 19, 20].map((hour) => (
            { dayOfWeek: 6, hour, availableCount: 4, totalCount: 4, staleCount: 0, unknownCount: 0 }
        )),
        { dayOfWeek: 0, hour: 20, availableCount: 2, totalCount: 4, staleCount: 0, unknownCount: 2 },
    ]);

    const group = (over: Partial<GroupOverlay> = {}): GroupOverlay => ({
        cells: CELLS,
        viewerSlots: avail(6, [19, 20]),
        onPickHour: vi.fn(),
        subtitle: 'Sep 19 · 4 in poll',
        ...over,
    });

    const renderGroup = (overlay: GroupOverlay, initialDay = 6) =>
        render(
            <PhoneWeekEditorCore
                slots={[]} hours={HOURS} initialDay={initialDay} dims={DIMS} group={overlay}
            />,
        );

    it('renders the group day instead of the block editor', () => {
        renderGroup(group());
        expect(screen.getByTestId('phone-group-cell-6-19')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-day-grid')).not.toBeInTheDocument();
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('Sep 19 · 4 in poll');
    });

    it('reports a tapped cell with the day it was tapped on', () => {
        const onPickHour = vi.fn();
        renderGroup(group({ onPickHour }));
        fireEvent.click(screen.getByTestId('phone-group-cell-6-19'));
        expect(onPickHour).toHaveBeenCalledWith(6, 19);
    });

    it('draws the week strip from the group, not from the viewer', () => {
        renderGroup(group());
        // ROK-1584: the label names the band it is reporting.
        expect(screen.getByLabelText('Saturday, evening: everyone free')).toBeInTheDocument();
        expect(screen.getByLabelText('Sunday, evening: a few free')).toBeInTheDocument();
        expect(screen.getByLabelText('Monday, nobody free')).toBeInTheDocument();
    });

    it('pages past Saturday into the next week, landing on Sunday', () => {
        const onWeekStep = vi.fn();
        renderGroup(group({ onWeekStep }));
        fireEvent.click(screen.getByLabelText('Next day'));
        expect(onWeekStep).toHaveBeenCalledWith(1);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Sunday');
    });

    it('pages before Sunday into the previous week, landing on Saturday', () => {
        const onWeekStep = vi.fn();
        renderGroup(group({ onWeekStep }), 0);
        fireEvent.click(screen.getByLabelText('Previous day'));
        expect(onWeekStep).toHaveBeenCalledWith(-1);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Saturday');
    });

    it('still stops at the ends of the week when no week step is offered', () => {
        renderGroup(group());
        expect(screen.getByLabelText('Next day')).toBeDisabled();
    });
});
// ROK-1587: the poll's existing slots reach both the group day and the strip.
describe('PhoneWeekEditorCore — group mode slot marks', () => {
    const CELLS = toGroupCellMap([
        { dayOfWeek: 6, hour: 19, availableCount: 4, totalCount: 4, staleCount: 0, unknownCount: 0 },
    ]);
    const renderGroup = (slotMarks?: GroupOverlay['slotMarks']) =>
        render(
            <PhoneWeekEditorCore
                slots={[]} hours={HOURS} initialDay={6} dims={DIMS}
                group={{ cells: CELLS, viewerSlots: [], slotMarks }}
            />,
        );
    it('draws the poll slots on the day and counts them in the strip', () => {
        const slotMarks = new Map([
            { dayOfWeek: 6, hour: 19, votes: 2 },
            { dayOfWeek: 6, hour: 21, votes: 0 },
            { dayOfWeek: 0, hour: 20, votes: 1 },
        ].map((mark) => [groupCellKey(mark.dayOfWeek, mark.hour), mark]));
        renderGroup(slotMarks);
        expect(screen.getByTestId('phone-group-slot-block-19')).toHaveTextContent('2 voted');
        expect(screen.getByTestId('phone-group-slot-block-21')).toHaveTextContent('0 voted');
        const strip = (d: number) => screen.getByTestId(`phone-week-strip-day-${d}`);
        expect(strip(6).querySelector('[data-testid="phone-week-strip-votes"]')).toHaveTextContent('● 2');
        expect(strip(0).querySelector('[data-testid="phone-week-strip-votes"]')).toHaveTextContent('● 1');
        expect(strip(6).getAttribute('aria-label')).toMatch(/, 2 suggested times$/);
    });

    it('draws no slot marks and empty strip spacers without slots', () => {
        renderGroup();
        expect(screen.queryByTestId('phone-group-slot-chip')).toBeNull();
        const markers = screen.getAllByTestId('phone-week-strip-votes');
        expect(markers).toHaveLength(7);
        expect(markers.every((m) => m.textContent === '')).toBe(true);
    });
});
// ROK-1585 (Q1): the caller resolves which strip days are away; the editor only
// forwards them to the strip.
describe('PhoneWeekEditorCore — away days', () => {
    it('forwards awayDays to the week strip', () => {
        render(
            <PhoneWeekEditorCore
                slots={[]} onChange={vi.fn()} hours={HOURS} initialDay={2} dims={DIMS}
                awayDays={new Set([5])}
            />,
        );
        expect(screen.getByTestId('phone-week-strip-day-5')).toHaveAttribute('data-away', 'true');
        expect(screen.getByLabelText('Friday, no hours free, away')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-strip-day-4')).not.toHaveAttribute('data-away');
    });

    it('marks no day away when the caller gives none', () => {
        render(<Harness initial={[]} />);
        expect(document.querySelector('[data-away]')).toBeNull();
    });
});

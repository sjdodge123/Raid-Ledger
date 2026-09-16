/**
 * The phone's read-only GROUP day (ROK-1580) — one day of the poll aggregate,
 * painted by the same rule as the seven-column heatmap, with the viewer's own
 * saved week outlined on top.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { computeHeatmapBg } from '../../grid-cell.utils';
import { toGroupCellMap } from '../group-day.utils';
import { GroupDayView } from '../GroupDayView';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const DAY = 2;

const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));

/** Tuesday: everyone free at 7 PM, most at 8 PM, one stale at 9 PM, nobody at 10 PM. */
const CELLS = toGroupCellMap([
    { dayOfWeek: DAY, hour: 19, availableCount: 4, totalCount: 4, staleCount: 0, unknownCount: 0 },
    { dayOfWeek: DAY, hour: 20, availableCount: 3, totalCount: 4, staleCount: 0, unknownCount: 1 },
    { dayOfWeek: DAY, hour: 21, availableCount: 3, totalCount: 4, staleCount: 1, unknownCount: 0 },
    { dayOfWeek: DAY, hour: 22, availableCount: 0, totalCount: 4, staleCount: 0, unknownCount: 4 },
]);

/** The same Tuesday, with two members signed up elsewhere at 8 PM (ROK-1584). */
const BUSY_CELLS = toGroupCellMap([
    { dayOfWeek: DAY, hour: 19, availableCount: 4, totalCount: 4, busyCount: 0 },
    { dayOfWeek: DAY, hour: 20, availableCount: 1, totalCount: 4, staleCount: 0, busyCount: 2 },
]);

const renderView = (over: Partial<Parameters<typeof GroupDayView>[0]> = {}) =>
    render(
        <GroupDayView
            dayOfWeek={DAY}
            hours={HOURS}
            cells={CELLS}
            viewerSlots={avail(DAY, [19, 20, 21])}
            onPickHour={vi.fn()}
            {...over}
        />,
    );

describe('GroupDayView — cells', () => {
    it('draws one tappable cell per visible hour', () => {
        renderView();
        expect(document.querySelectorAll('[data-testid^="phone-group-cell-"]')).toHaveLength(HOURS.length);
        expect(screen.getByTestId(`phone-group-cell-${DAY}-17`).tagName).toBe('BUTTON');
    });

    it('paints each cell with the shared heatmap rule, not a rule of its own', () => {
        renderView();
        const everyone = screen.getByTestId(`phone-group-cell-${DAY}-19`);
        const expected = computeHeatmapBg({ available: 4, total: 4, stale: 0, unknown: 0 });
        expect(expected).toBeDefined();
        expect(everyone.style.background).toBe(expected);
        // Nobody known — no fill at all (the phone draws no hatch).
        expect(screen.getByTestId(`phone-group-cell-${DAY}-22`).style.background).toBe('');
    });

    it('puts the short count inside the cell and the full copy in the aria-label', () => {
        renderView();
        expect(screen.getByTestId(`phone-group-cell-${DAY}-21`)).toHaveTextContent('3 free · 1 stale');
        expect(screen.getByTestId(`phone-group-cell-${DAY}-21`))
            .toHaveAttribute('aria-label', '3 free · 1 stale · 0 unknown');
        expect(screen.getByTestId(`phone-group-cell-${DAY}-22`)).toHaveTextContent('0 free');
    });

    it('says an hour the aggregate does not carry has no data', () => {
        renderView();
        const empty = screen.getByTestId(`phone-group-cell-${DAY}-17`);
        expect(empty).toHaveAttribute('aria-label', 'no data');
        expect(empty).toHaveTextContent('');
    });

    it('reports the tapped hour', () => {
        const onPickHour = vi.fn();
        renderView({ onPickHour });
        fireEvent.click(screen.getByTestId(`phone-group-cell-${DAY}-20`));
        expect(onPickHour).toHaveBeenCalledWith(20);
    });
});

describe('GroupDayView — overlays', () => {
    it('outlines the viewer’s own saved hours as one dashed block', () => {
        renderView();
        const blocks = screen.getAllByTestId('phone-group-you-block');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toHaveTextContent('You · 7 – 10 PM');
        // Indices 2..5 of seven visible hours.
        expect(blocks[0].style.top).toBe(`${(2 / 7) * 100}%`);
        expect(blocks[0].style.height).toBe(`${(3 / 7) * 100}%`);
    });

    it('keeps the percent geometry honest on a longer window (review 5b)', () => {
        // 9 AM..1 AM — the profile's 17 hours; a 7–10 PM block is indices 10..13.
        const long = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1];
        renderView({ hours: long, suggested: { dayOfWeek: DAY, hour: 23 } });
        const you = screen.getByTestId('phone-group-you-block');
        expect(you.style.top).toBe(`${(10 / 17) * 100}%`);
        expect(you.style.height).toBe(`${(3 / 17) * 100}%`);
        // The suggestion crosses midnight: 11 PM – 1 AM (review 5c).
        const block = screen.getByTestId('phone-group-suggested-block');
        expect(block.style.top).toBe(`${(14 / 17) * 100}%`);
        expect(block).toHaveTextContent('11 PM');
    });

    it('renders a read-only day as labelled tiles, not buttons (review 2a)', () => {
        renderView({ onPickHour: undefined });
        const cell = screen.getByTestId(`phone-group-cell-${DAY}-19`);
        expect(cell.tagName).toBe('DIV');
        expect(cell).toHaveAttribute('role', 'img');
        expect(cell).toHaveAttribute('aria-label', '4 free · 0 unknown');
        expect(cell).toHaveTextContent('4 free');
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('draws nothing of the viewer on a day they saved nothing on', () => {
        renderView({ viewerSlots: avail(5, [19, 20]) });
        expect(screen.queryByTestId('phone-group-you-block')).not.toBeInTheDocument();
    });

    it('draws the two-hour suggestion from the tapped hour', () => {
        renderView({ suggested: { dayOfWeek: DAY, hour: 20 } });
        const block = screen.getByTestId('phone-group-suggested-block');
        expect(block).toHaveTextContent('2h · Suggested 8 PM');
        // Its label sits at the bottom so it never overprints the 'You' label above (operator plan finding).
        expect(block.className).toContain('items-end');
        expect(block.style.top).toBe(`${(3 / 7) * 100}%`);
        expect(block.style.height).toBe(`${(2 / 7) * 100}%`);
    });

    it('ignores a suggestion made on another day', () => {
        renderView({ suggested: { dayOfWeek: DAY + 1, hour: 20 } });
        expect(screen.queryByTestId('phone-group-suggested-block')).not.toBeInTheDocument();
    });
});

// ROK-1584: members whose template covers an hour but who are signed up for
// something else are subtracted from the free count (ROK-1570) — the cell has
// to say so, or "1 free" reads as "three people never set a week".
describe('GroupDayView — busy', () => {
    it('marks a busy cell with the purple left edge and counts it in data-busy', () => {
        renderView({ cells: BUSY_CELLS });
        const busy = screen.getByTestId(`phone-group-cell-${DAY}-20`);
        expect(busy).toHaveAttribute('data-busy', '2');
        expect(busy.className).toContain('before:bg-busy');
        expect(busy.className).toContain('before:w-[5px]');
    });

    it('appends "· N busy" to the count, in the busy colour', () => {
        renderView({ cells: BUSY_CELLS });
        const busy = screen.getByTestId(`phone-group-cell-${DAY}-20`);
        expect(busy).toHaveTextContent('1 free · 2 busy');
        expect(busy.querySelector('.text-busy')?.textContent).toBe(' · 2 busy');
    });

    it('leaves a cell nobody is busy in exactly as it was', () => {
        renderView({ cells: BUSY_CELLS });
        const free = screen.getByTestId(`phone-group-cell-${DAY}-19`);
        expect(free).not.toHaveAttribute('data-busy');
        expect(free.className).not.toContain('before:bg-busy');
        expect(free.querySelector('.text-busy')).toBeNull();
        expect(free).toHaveTextContent('4 free');
    });
});

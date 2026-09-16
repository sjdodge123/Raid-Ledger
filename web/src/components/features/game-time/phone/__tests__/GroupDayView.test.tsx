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

    it('draws nothing of the viewer on a day they saved nothing on', () => {
        renderView({ viewerSlots: avail(5, [19, 20]) });
        expect(screen.queryByTestId('phone-group-you-block')).not.toBeInTheDocument();
    });

    it('draws the two-hour suggestion from the tapped hour', () => {
        renderView({ suggested: { dayOfWeek: DAY, hour: 20 } });
        const block = screen.getByTestId('phone-group-suggested-block');
        expect(block).toHaveTextContent('2h · Suggested 8 PM');
        expect(block.style.top).toBe(`${(3 / 7) * 100}%`);
        expect(block.style.height).toBe(`${(2 / 7) * 100}%`);
    });

    it('ignores a suggestion made on another day', () => {
        renderView({ suggested: { dayOfWeek: DAY + 1, hour: 20 } });
        expect(screen.queryByTestId('phone-group-suggested-block')).not.toBeInTheDocument();
    });
});

/** ROK-2187 — the mockup's month histogram and 52-week streak strip. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GgMonthHistogram, GgWeekStreak, ggLongestRun } from './gg-year-visuals';

describe('ggLongestRun', () => {
    it('finds the longest run of attended weeks', () => {
        expect(ggLongestRun([true, false, true, true, true, false, true, true])).toEqual({ start: 2, length: 3 });
    });
    it('is empty when no week was attended', () => {
        expect(ggLongestRun([false, false])).toEqual({ start: 0, length: 0 });
    });
});

describe('GgMonthHistogram', () => {
    it('draws twelve bars and marks the busiest month', () => {
        render(<GgMonthHistogram counts={[3, 4, 8, 5, 4, 2, 3, 2, 4, 5, 6, 1]} />);
        expect(screen.getByRole('img', { name: 'Events per month — busiest: March (8)' })).toBeInTheDocument();
        const bars = screen.getAllByTestId('gg-hist-bar');
        expect(bars).toHaveLength(12);
        expect(bars[2]).toHaveAttribute('data-peak', 'true');
        expect(bars[0]).toHaveAttribute('data-peak', 'false');
    });
});

describe('GgWeekStreak', () => {
    it('marks attended weeks and highlights the longest streak', () => {
        const weeks = Array.from({ length: 52 }, (_, i) => (i >= 14 && i < 26) || i === 0);
        render(<GgWeekStreak weeks={weeks} />);
        expect(screen.getByRole('img', { name: '52 weeks, 12-week streak highlighted' })).toBeInTheDocument();
        const cells = screen.getAllByTestId('gg-week');
        expect(cells).toHaveLength(52);
        expect(cells[0]).toHaveAttribute('data-state', 'on');
        expect(cells[14]).toHaveAttribute('data-state', 'run');
        expect(cells[1]).toHaveAttribute('data-state', 'off');
    });
});
